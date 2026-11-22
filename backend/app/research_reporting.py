"""Immutable research snapshot rendering. No clinical approval or inferred grading."""
import csv
from hashlib import sha256
from io import BytesIO, StringIO
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile
from .evidence_status import stenosis_mask_status
from .report_pdf import ResearchPDF

SECTIONS = {'images', 'measurements', 'candidates', 'review', 'appendix'}
NOTICE = ('Research output, not a standalone diagnosis. Model scores are uncalibrated. '
          'Mask pixels do not establish narrowing or clinical severity. Missing measurements are unavailable, not zero. '
          'This research snapshot is not a clinically approved report.')

REASON_LABELS = {
    'low_local_boundary_contrast': 'Insufficient local vessel boundary contrast',
    'candidate_vessel_association_unverified': 'Vessel association could not be verified',
    'original_coordinate_mapping_unavailable': 'Original-image coordinate mapping is unavailable',
    'required_run_bound_image_or_mask_unavailable': 'Required run-bound image or mask is unavailable',
    'reference_not_stable': 'A stable reference segment was not available',
    'measurement_sensitivity_too_high': 'Measurement sensitivity was too high',
}


def reason_text(value):
    if not value:
        return 'Quality requirements were not satisfied'
    return REASON_LABELS.get(str(value), str(value).replace('_', ' ').capitalize())


def _automatic_eligible(record):
    cross = record.get('cross_section_assessment') or {}
    severity = record.get('severity') or {}
    return bool(
        record.get('status') not in {'abstained', 'unavailable'}
        and record.get('quality_status') != 'exploratory_only_quality_gate_failed'
        and record.get('eligible_for_reference_validation') is not False
        and cross.get('status') != 'abstained'
        and not cross.get('reasons')
        and record.get('minimum_diameter') is not None
        and record.get('reference_diameter') is not None
        and record.get('narrowing_percent') is not None
        and severity.get('category')
    )


def primary_candidate_rows(snapshot):
    """Resolve one quality-controlled row per saved candidate without altering history."""
    result = snapshot.get('analysis') or {}
    candidates = ((result.get('structured_result') or {}).get('candidates') or [])
    latest = (snapshot.get('automatic_measurements') or [{}])[0]
    automatic = {row.get('candidate_id'): row for row in latest.get('records', [])}
    reviewed = {}
    for item in snapshot.get('reviewed_stenosis_measurements') or []:
        row = item.get('result') or {}
        reviewed.setdefault(row.get('candidate_id'), row)
    rows = []
    for candidate in candidates:
        candidate_id = candidate.get('candidate_id') or 'Candidate'
        manual = reviewed.get(candidate_id)
        auto = automatic.get(candidate_id) or {}
        manual_ok = bool(manual and (manual.get('quality_gate') or {}).get('status') == 'passed')
        auto_ok = _automatic_eligible(auto)
        source = manual if manual_ok else auto
        eligible = manual_ok or auto_ok
        cross = auto.get('cross_section_assessment') or {}
        reasons = cross.get('reasons') or auto.get('reasons') or []
        if manual and not manual_ok:
            reasons = [(manual.get('quality_gate') or {}).get('reason') or 'reviewed_measurement_quality_gate_failed']
        rows.append({
            'candidate_id': candidate_id,
            'model_score': candidate.get('model_score'),
            'vessel_path': (source.get('association') or {}).get('path_id'),
            'status': 'Eligible' if eligible else 'Abstained',
            'minimum_diameter': source.get('minimum_diameter') if eligible else None,
            'reference_diameter': source.get('reference_diameter') if eligible else None,
            'narrowing_percent': source.get('narrowing_percent') if eligible else None,
            'unit': source.get('diameter_unit') or source.get('unit') or 'source px',
            'severity': ((source.get('severity') or {}).get('category') if eligible else None),
            'exploratory_minimum_diameter': auto.get('minimum_diameter') if not auto_ok else None,
            'exploratory_reference_diameter': auto.get('reference_diameter') if not auto_ok else None,
            'exploratory_narrowing_percent': auto.get('narrowing_percent') if not auto_ok else None,
            'exploratory_severity': ((auto.get('severity') or {}).get('category') if not auto_ok else None),
            'reason': None if eligible else reason_text(reasons[0] if reasons else None),
            'review_status': 'Reviewed measurement' if manual_ok else ('No human review' if not snapshot.get('human_review') else 'Run reviewed'),
            'eligible': eligible,
        })
    return rows


def evidence_zip(snapshot, pdf, saved_artifacts=None):
    """Package the authorized snapshot and its rendered exports."""
    files = {
        'report.json': json.dumps(snapshot, indent=2).encode('utf-8'),
        'report.csv': tabular(snapshot).encode('utf-8'),
        'report.pdf': pdf,
    }
    for name, path in (saved_artifacts or {}).items():
        if path.is_file():
            files['saved_artifacts/'+name+path.suffix] = path.read_bytes()
    structured = snapshot['analysis'].get('structured_result') or {}
    files['candidates.json'] = json.dumps(structured.get('candidates', []), indent=2).encode()
    files['measurements.json'] = json.dumps(snapshot.get('automatic_measurements', []), indent=2).encode()
    if snapshot.get('vessel_segments'):
        files['vessel_segments.json'] = json.dumps(snapshot['vessel_segments'], indent=2).encode()
    files['model_provenance.json'] = json.dumps(snapshot.get('provenance', {}), indent=2).encode()
    manifest = {
        'schema_version': 1,
        'report_id': snapshot['report_id'],
        'report_version': snapshot['version'],
        'case_id': snapshot['case']['id'],
        'image_id': snapshot['image']['id'],
        'analysis_run_id': snapshot['analysis']['id'],
        'artifacts': [
            {'path': name, 'bytes': len(content), 'sha256': sha256(content).hexdigest()}
            for name, content in files.items()
        ],
    }
    buffer = BytesIO()
    with ZipFile(buffer, 'w', compression=ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
        archive.writestr('manifest.json', json.dumps(manifest, indent=2))
    return buffer.getvalue()


def stenosis_count_text(result):
    status = stenosis_mask_status(result)
    if status == 'not_assessed':
        return 'Not assessed'
    if status == 'not_saved':
        return 'Not saved'
    count = result.get('stenosis_pixels') if isinstance(result, dict) else None
    return f'{count} px' if count is not None else 'Unavailable'


def tabular(snapshot):
    result = snapshot['analysis']
    vessel = result.get('vessel_analysis') or {}
    review = snapshot.get('human_review') or {}
    primary = primary_candidate_rows(snapshot)
    eligible_severity = {
        row['candidate_id']: row['severity']
        for row in primary if row['eligible'] and row.get('severity')
    }
    automated_severity = (
        json.dumps(eligible_severity, ensure_ascii=False)
        if eligible_severity else ('indeterminate' if primary else 'unavailable')
    )
    fields = {'report_id': snapshot['report_id'], 'report_version': snapshot['version'],
              'evidence_class': snapshot.get('evidence_class', 'EXPLORATORY_RESEARCH_ESTIMATE'),
              'generated_at': snapshot['generated_at'], 'case_id': snapshot['case']['id'],
              'case_code': snapshot['case']['case_code'], 'image_id': snapshot['image']['id'],
              'analysis_run_id': result['id'], 'model_version': result['model_version'],
              'artery_pixels': result['artery_pixels'],
              'stenosis_pixels': result['stenosis_pixels'] if stenosis_mask_status(result) == 'recorded' else None,
              'stenosis_mask_status': stenosis_mask_status(result),
              'centerline_length': vessel.get('centerline_length'), 'mean_diameter': vessel.get('mean_diameter'),
              'measurement_unit': vessel.get('diameter_unit'), 'human_review_id': review.get('id'),
              'human_assessed_severity': review.get('stenosis_severity'),
              'automated_severity': automated_severity,
              'saved_candidate_count': len(primary),
              'eligible_measurement_count': sum(row['eligible'] for row in primary),
              'abstention_count': sum(not row['eligible'] for row in primary),
              'primary_candidate_assessment': json.dumps(primary, ensure_ascii=False),
              'notice': NOTICE}
    if 'measurements' not in snapshot['sections']:
        for key in ['centerline_length', 'mean_diameter', 'measurement_unit']:
            fields.pop(key)
    else:
        fields['reviewed_stenosis_measurements'] = json.dumps(snapshot.get('reviewed_stenosis_measurements', []), ensure_ascii=False)
        fields['automatic_measurements'] = json.dumps(snapshot.get('automatic_measurements', []), ensure_ascii=False)
    if 'review' not in snapshot['sections']:
        for key in ['human_review_id', 'human_assessed_severity']:
            fields.pop(key)
    if 'images' in snapshot['sections']:
        fields['image_panels'] = json.dumps(snapshot.get('image_panels', []), ensure_ascii=False)
    def safe(value):
        text = 'Unavailable' if value is None else str(value)
        return "'" + text if text.startswith(('=', '+', '-', '@', '\t', '\r')) else text
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(fields.keys())
    writer.writerow([safe(v) for v in fields.values()])
    return output.getvalue()


def pdf_bytes(snapshot, image_paths):
    from reportlab.lib.utils import ImageReader
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, Spacer, Table, TableStyle

    report = ResearchPDF('Coronary angiography research report')
    case, image, result = (snapshot[key] for key in ('case', 'image', 'analysis'))
    sections = snapshot['sections']
    structured = result.get('structured_result') or {}
    vessel = result.get('vessel_analysis') or {}
    rows = primary_candidate_rows(snapshot)
    eligible = [row for row in rows if row['eligible']]
    abstained = [row for row in rows if not row['eligible']]
    review = snapshot.get('human_review')
    latest = (snapshot.get('automatic_measurements') or [{}])[0]
    protocol = latest.get('protocol_authorization') or {}

    def cell(value, style=None):
        return Paragraph(escape(str(value)), style or report.table_body)

    def table(data, widths, header=True):
        styling = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('GRID', (0, 0), (-1, -1), .5, colors.HexColor('#ccd8e4')),
                   ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
                   ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7)]
        if header:
            styling += [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eaf0f5')),
                        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1e2e40'))]
        return Table(data, colWidths=widths, repeatRows=1 if header else 0,
                     hAlign='LEFT', style=TableStyle(styling))

    # Page 1 — the current quality-controlled result.
    report.story.append(Paragraph('COROVISION AI · 2D RESEARCH ANALYSIS', report.eyebrow))
    report.paragraph('EXPERIMENTAL RESEARCH ANALYSIS — NOT CLINICALLY VALIDATED')
    summary = [
        [cell('Case', report.table_label), cell(case['case_code']), cell('Report', report.table_label), cell(f"v{snapshot['version']}")],
        [cell('Study', report.table_label), cell(image.get('original_name')), cell('Modality', report.table_label), cell(case.get('modality') or 'Unavailable')],
        [cell('Analysis run', report.table_label), cell(result['id']), cell('Model', report.table_label), cell(result.get('model_version') or 'Unavailable')],
        [cell('Saved candidates', report.table_label), cell(len(rows)), cell('Eligible / abstained', report.table_label), cell(f'{len(eligible)} / {len(abstained)}')],
        [cell('Human review', report.table_label), cell('Linked' if review else 'Not linked'), cell('Generated (UTC)', report.table_label), cell(snapshot['generated_at'].replace('T', ' ').split('.')[0])],
    ]
    report.story.append(table(summary, [70, 174, 92, 158], header=False))
    report.section('Analysis summary')
    if rows and not eligible:
        report.paragraph(f'{len(rows)} suspected stenosis candidate locations were saved. All primary quantitative assessments abstained because the recorded quality requirements were not satisfied. Exploratory mask-width categories are retained below as supporting evidence, but no accepted automatic severity category is available.')
    elif eligible:
        report.paragraph(f'{len(rows)} suspected stenosis candidate locations were saved. {len(eligible)} measurement(s) passed the recorded research quality requirements; {len(abstained)} abstained. Results remain experimental and require expert review.')
    else:
        report.paragraph('No saved stenosis candidate is available for diameter-based grading. No normal finding is inferred.')
    report.story.append(Spacer(1, 8))
    report.story.append(table([
        [cell('Candidate', report.table_header), cell('Measurement', report.table_header), cell('Narrowing', report.table_header), cell('Severity', report.table_header)],
        *[[cell(row['candidate_id']), cell(row['status']), cell(f"{row['narrowing_percent']:.2f}%" if row['eligible'] else 'Unavailable'), cell(row['severity'] or 'Indeterminate')] for row in rows]
    ], [82, 150, 125, 137]))
    report.section('Primary limitations')
    for message in dict.fromkeys(row['reason'] for row in abstained if row['reason']):
        report.paragraph('- ' + message + '.')
    if not review:
        report.paragraph('- No human review is linked to this immutable report snapshot.')
    report.paragraph('Research use only. This document is not a clinical diagnostic report.')

    # Page 2 — saved images in their recorded coordinate frames.
    report.story.append(PageBreak())
    report.section('Images and localization')
    report.paragraph('Original and model-derived views are labelled separately. A prepared-grid overlay is not represented as verified original-image localization.')
    figures = []
    column_width = report.document.width / 2 - 8
    for label, path in image_paths:
        if path is None or (isinstance(path, Path) and not path.is_file()):
            continue
        source = str(path) if isinstance(path, Path) else path
        try:
            width, height = ImageReader(source).getSize()
        except (OSError, ValueError, TypeError):
            continue
        scale = min((column_width - 12) / width, 245 / height)
        if hasattr(source, 'seek'):
            source.seek(0)
        figures.append([Image(source, width=width * scale, height=height * scale), Paragraph(escape(label), report.caption)])
    if figures:
        report.story.append(table([figures], [column_width] * len(figures), header=False))
    else:
        report.paragraph('No selected saved images could be rendered.')
    report.section('Localization evidence')
    for candidate in structured.get('candidates') or []:
        bounds = candidate.get('bbox_source_xyxy')
        formatted = ', '.join(f'{float(value):.2f}' for value in bounds) if bounds else None
        report.field(candidate.get('candidate_id') or 'Candidate', f"Original-coordinate bounds [{formatted}] px" if formatted else 'Original-coordinate mapping unavailable')

    # Page 3 — one current row per candidate.
    report.story.append(PageBreak())
    report.section('Candidate results and measurements')
    candidate_data = [[cell(value, report.table_header) for value in ['Candidate', 'Score', 'Vessel', 'Minimum / reference', 'Narrowing', 'Quality', 'Severity']]]
    for row in rows:
        measurement = f"{row['minimum_diameter']:.2f} / {row['reference_diameter']:.2f} {row['unit']}" if row['eligible'] else 'Unavailable'
        candidate_data.append([cell(row['candidate_id']), cell(f"{row['model_score']:.3f}" if row['model_score'] is not None else 'N/A'),
            cell(row['vessel_path'] or 'Unverified'), cell(measurement),
            cell(f"{row['narrowing_percent']:.2f}%" if row['eligible'] else 'Unavailable'), cell(row['status']), cell(row['severity'] or 'Indeterminate')])
    report.story.append(table(candidate_data, [66, 42, 54, 108, 68, 70, 87]))
    report.story.append(Spacer(1, 10))
    segments = snapshot.get('vessel_segments') or {}
    if segments.get('status') == 'completed' and segments.get('records'):
        labels = {'assigned': None, 'unreliable_segment': 'side branch, not named', 'ambiguous': 'ambiguous',
                  'no_vessel_predicted': 'not assessable', 'region_unavailable': 'not assessable'}
        parts = [f"{r['candidate_id']}: " + (f"segment {r['segment']} ({r['anatomy']}), vote share {r['vote_share']:.0%}"
                 if r['outcome'] == 'assigned' else labels.get(r['outcome'], 'not assessable')) for r in segments['records']]
        report.paragraph('Likely vessel segment (research label, frozen protocol corovision-lesion-to-segment-v1; '
                         'validation-only evidence, side-branch lesions may be named as the parent vessel): ' + '; '.join(parts) + '.')
    for row in abstained:
        exploratory = ''
        if row.get('exploratory_narrowing_percent') is not None or row.get('exploratory_severity'):
            narrowing = f"{row['exploratory_narrowing_percent']:.2f}%" if row.get('exploratory_narrowing_percent') is not None else 'unavailable narrowing'
            category = row.get('exploratory_severity') or 'ungraded'
            exploratory = f' Exploratory mask-width result: {narrowing}, {category} category.'
        report.paragraph(f"{row['candidate_id']}: {row['reason']}.{exploratory} This exploratory result is not an accepted primary measurement.")

    # Page 4 — protocol and explainability availability.
    report.story.append(PageBreak())
    report.section('Severity, quality and explainability')
    report.field('Research protocol', protocol.get('protocol_id') or 'Unavailable')
    report.field('Protocol version', protocol.get('protocol_version'))
    report.field('Protocol status', str(protocol.get('status') or 'Unavailable').replace('_', ' ').capitalize())
    report.field('Accepted automatic grades', len(eligible))
    report.field('Indeterminate candidates', len(abstained))
    report.field('Uncertainty', 'Unavailable for abstained measurements' if abstained else 'See saved sensitivity evidence')
    report.section('Explainability evidence')
    available_panels = [panel.get('title') for panel in snapshot.get('image_panels') or [] if panel.get('available')]
    report.paragraph('Available saved evidence: ' + ', '.join(available_panels) if available_panels else 'No verified attribution image is saved for this run.')
    report.paragraph('No demonstration heatmap or inferred explanation is inserted into this report.')

    # Page 5 — concise methods, limitations and review state.
    report.story.append(PageBreak())
    report.section('Methods, limitations and review')
    report.field('Segmentation model', result.get('model_version'))
    report.field('Candidate detection', 'Saved model candidate bounds and uncalibrated scores')
    report.field('Measurement method', (latest.get('measurement_method') or {}).get('id'))
    report.field('Calibration', 'Unavailable' if vessel.get('diameter_unit') == 'px' or not vessel.get('diameter_unit') else vessel.get('diameter_unit'))
    report.field('Artery mask', f"{result.get('artery_pixels', 0):,} px")
    report.field('Stenosis mask', stenosis_count_text(result))
    report.field('Review status', 'No run-linked human review' if not review else str(review.get('decision', 'Recorded')).replace('_', ' ').capitalize())
    for flag in vessel.get('quality_flags', []):
        if flag.get('message'):
            report.paragraph('- ' + flag['message'])
    report.paragraph(NOTICE)

    if 'appendix' in sections:
        report.story.append(PageBreak())
        report.section('Technical audit reference')
        report.field('Report ID', snapshot['report_id'])
        report.field('Analysis date', result.get('created_at'))
        report.field('Saved automatic assessment snapshots', len(snapshot.get('automatic_measurements') or []))
        report.paragraph('Full assessment history, identifiers, hashes, coordinates and full-precision exploratory values are preserved in JSON, CSV and the Evidence ZIP.')

    return report.build()
