"""Read-only explanations of saved 3D runs; never infer missing stages."""
import csv
import hashlib
import json
from io import StringIO

from .report_pdf import ResearchPDF


def snapshot(run):
    result = run.get('result')
    if run.get('status') != 'completed' or not isinstance(result, dict) or not result.get('model_id'):
        raise ValueError('A completed persisted volume result is required')
    stages = {
        'segmentation': {'status': 'review_required', 'reason': 'Saved model prediction; anatomical accuracy not established.'},
        'vessel_graph': {'status': 'unavailable', 'reason': 'No validated saved 3D centerline or graph in this run.'},
        'diameter_measurement': {'status': 'not_assessable', 'reason': 'No validated candidate-local cross-sectional measurement.'},
        'stenosis_detection': {'status': 'unavailable', 'reason': 'No compatible 3D stenosis checkpoint output in this run. No 2D substitution.'},
        'severity': {'status': 'not_assessable', 'reason': 'Valid local/reference diameters and approved severity protocol absent.'},
    }
    document = {'schema_version': 'corovision.volume-report.v1', 'case_id': run['case_id'],
        'analysis_run_id': run['id'], 'source_sha256': run.get('source_sha256'),
        'created_at': run.get('created_at'), 'input_kind': run.get('input_kind'),
        'model_id': result['model_id'], 'checkpoint_sha256': result.get('checkpoint_sha256'),
        'preprocessing': result.get('preprocessing'), 'source_shape': result.get('source_shape'),
        'source_affine_ras_mm': result.get('source_affine_ras_mm'),
        'execution_seconds': result.get('duration_seconds'),
        'predicted_coarse_foreground_voxels': result.get('coarse_foreground_voxels'),
        'stages': stages, 'narrowing_percent': None, 'severity_category': None,
        'human_assessment': run.get('geometry_review'), 'clinical_validated': False,
        'explanation': {'method': 'deterministic_saved_volume_template',
            'text': 'This saved volume run contains a segmentation prediction and orthogonal previews. '
                    'Foreground voxel count is not accuracy, lumen diameter, disease probability or stenosis severity. '
                    'Downstream unavailable stages were not executed. Review the original volume and model limitations.'},
        'artifacts': run.get('artifacts', {}), 'limitations': result.get('limitations', []),
        'explainable_ai': run.get('xai') or [],
        'reference_evaluations': run.get('reference_evaluations') or []}
    document['snapshot_sha256'] = hashlib.sha256(json.dumps(document, sort_keys=True, allow_nan=False).encode()).hexdigest()
    geometry = run.get('experimental_geometry')
    if geometry:
        # Older and abstained geometry records legitimately omit presentation-
        # only fields such as limitations.  Normalize the report contract
        # without rewriting the immutable saved measurement.
        reasons = geometry.get('reasons') or []
        geometry = {**geometry,
            'paths': geometry.get('paths') or [],
            'candidates': geometry.get('candidates') or [],
            'limitations': geometry.get('limitations') or
                ([f"Measurement withheld: {str(reason).replace('_', ' ')}." for reason in reasons]
                 if reasons else ['Experimental 3D mask geometry is unavailable for this saved run.'])}
        document['experimental_geometry'] = geometry
        if geometry.get('status') == 'experimental_mask_geometry':
            for name in ['vessel_graph', 'diameter_measurement', 'stenosis_detection', 'severity']:
                stages[name] = dict(status='experimental_mask_geometry', reason=f"Computed from saved mask using {geometry.get('method')}. {len(geometry.get('paths', []))} paths and {len(geometry.get('candidates', []))} narrowing candidates.")
            document['explanation']['text'] = 'Saved segmentation with physical-space skeleton paths, mask-width estimates and rule-based narrowing candidates.'
            candidates = geometry.get('candidates') or []
            if candidates:
                primary = candidates[0]
                document['narrowing_percent'] = primary.get('narrowing_percent')
                document['severity_category'] = primary.get('severity')
                document['severity_status'] = 'experimental_research_grade' if primary.get('severity') else 'grade_withheld'
                document['severity_candidate_id'] = primary.get('id')
        else:
            reason = ', '.join(str(item).replace('_', ' ') for item in reasons) or 'geometry quality gates did not pass'
            for name in ['vessel_graph', 'diameter_measurement', 'stenosis_detection', 'severity']:
                stages[name] = dict(status='not_assessable', reason=f'3D mask geometry withheld: {reason}.')
            document['explanation']['text'] = 'The saved segmentation is available, but downstream 3D geometry and stenosis measurements were withheld because their quality gates did not pass.'
            document['severity_status'] = 'indeterminate'
        document['snapshot_sha256'] = hashlib.sha256(json.dumps({k:v for k,v in document.items() if k != 'snapshot_sha256'}, sort_keys=True, allow_nan=False).encode()).hexdigest()
    return document


def csv_text(document):
    stream = StringIO()
    writer = csv.writer(stream)
    if document.get('report'):
        report = document['report']
        writer.writerow(['schema_version', 'case_id', 'run_id', 'report_id', 'report_version', 'source_sha256', 'snapshot_sha256'])
        writer.writerow([document['schema_version'], document['case_id'], document['analysis_run_id'], report['id'],
                         report['version'], document['source_sha256'], document['snapshot_sha256']])
        writer.writerow([])
    writer.writerow(['case_id', 'analysis_run_id', 'model_id', 'checkpoint_sha256', 'stage', 'status', 'reason'])
    def safe(value):
        text = '' if value is None else str(value)
        return "'" + text if (text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n'))) and not isinstance(value, (int, float)) else text
    for stage, item in document['stages'].items():
        writer.writerow([safe(x) for x in [document['case_id'],document['analysis_run_id'],document['model_id'],
            document['checkpoint_sha256'],stage,item['status'],item['reason']]])
    writer.writerow([])
    writer.writerow(['candidate_id','path_id','minimum_diameter_mm','reference_diameter_mm','diameter_narrowing_percent','experimental_grade','ras_mm','minimum_area_mm2','reference_area_mm2','area_narrowing_percent','uncertainty_status'])
    for candidate in document.get('experimental_geometry', {}).get('candidates', []):
        writer.writerow([safe(candidate.get(key)) for key in ['id','path_id','minimum_diameter_mm','reference_diameter_mm','narrowing_percent','severity','location_ras_mm','minimum_area_mm2','reference_area_mm2','area_narrowing_percent','uncertainty_status']])
    review = document.get('human_assessment') or {}
    if review.get('current'):
        writer.writerow([])
        writer.writerow(['review_path_id','decision','artery','reviewer_minimum_diameter_mm','reviewer_reference_diameter_mm','reviewer_narrowing_percent','diameter_method','minimum_position_mm','reference_position_mm','reviewer_role','reviewed_at','notes'])
        for row in review['current']:
            measured = row.get('measurement') or {}
            writer.writerow([safe(x) for x in [row['path_id'], row['decision'], row.get('artery'), measured.get('minimum_diameter_mm'),
                measured.get('reference_diameter_mm'), measured.get('narrowing_percent'), measured.get('diameter_method'),
                (measured.get('minimum') or {}).get('position_mm'), (measured.get('reference') or {}).get('position_mm'),
                row.get('reviewer_role'), row.get('reviewed_at'), row.get('notes')]])
    for record in document.get('reference_evaluations', []):
        writer.writerow([])
        writer.writerow(['reference_evaluation_id','dice','iou','hd95_mm','assd_mm','source_sha256','prediction_sha256','reference_sha256','provenance'])
        writer.writerow([safe(x) for x in [record['id'], *[record['metrics'].get(k) for k in ('dice','iou','hd95','assd')], record['source_sha256'], record['prediction_sha256'],record['reference_sha256'],record['provenance']]])
    return stream.getvalue()


def pdf_bytes(document, artifacts=None):
    from reportlab.lib import colors
    from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, Table, TableStyle
    from xml.sax.saxutils import escape
    from io import BytesIO

    artifacts = artifacts or {}

    report = ResearchPDF('3D vessel analysis report')
    geometry = document.get('experimental_geometry')
    candidates = (geometry or {}).get('candidates', [])

    def cell(value, style=None):
        return Paragraph(escape(str(value)), style or report.table_body)

    report.story.append(Paragraph('COROVISION AI · 3D RESEARCH ANALYSIS', report.eyebrow))
    summary = Table([
        [cell('Case', report.table_label), cell(document['case_id']), cell('Model', report.table_label), cell(document['model_id'])],
        [cell('Analysis run', report.table_label), cell(document['analysis_run_id']), cell('Study type', report.table_label), cell((document.get('input_kind') or 'Unavailable').replace('_', ' ').capitalize())],
        [cell('Source volume', report.table_label), cell(' × '.join(map(str, document.get('source_shape') or [])) + ' voxels'), cell('Candidates', report.table_label), cell(len(candidates))],
    ], colWidths=[70, 174, 78, 172], style=TableStyle([('GRID',(0,0),(-1,-1),.5,colors.HexColor('#ccd8e4')),('VALIGN',(0,0),(-1,-1),'TOP'),('PADDING',(0,0),(-1,-1),7)]))
    if document.get('case_code'):
        report.section(document['case_code'])
    report.story.append(summary)
    identity = document.get('report')
    if identity:
        report.field('Report ID / version', f"{identity['id']} / {identity['version']}")
        report.field('Generated at', identity['generated_at'])
        report.field('Review status at export', identity['review_status'])
        report.field('Modality / processing', f"{document.get('modality') or 'Unavailable'} / completed")
        report.field('Frozen checkpoint SHA-256', document.get('checkpoint_sha256'))
    report.section('Analysis summary')
    if candidates:
        first = candidates[0]
        grade = f"experimental {first['severity']}" if first.get('severity') else 'Grade withheld'
        report.paragraph(f"{len(candidates)} experimental narrowing candidate(s) were identified from component-local saved-mask geometry. The leading candidate has {first['narrowing_percent']:.2f}% diameter narrowing. Research grade: {grade}. Expert review is required.")
    else:
        report.paragraph('No quality-eligible 3D narrowing candidate is available. No normal finding is inferred.')
    report.field('Segmentation', document['stages']['segmentation']['status'].replace('_',' ').capitalize())
    report.field('Severity readiness', document['stages']['severity']['status'].replace('_',' ').capitalize())
    report.paragraph('Research use only. This document is not a clinical diagnostic report.')

    report.story.append(PageBreak())
    report.section('Source CTA and preprocessing')
    report.field('Source dimensions', ' × '.join(map(str, document.get('source_shape') or [])) + ' voxels')
    report.field('Predicted coarse-grid foreground', document.get('predicted_coarse_foreground_voxels'))
    report.field('Extracted centerline paths', len((geometry or {}).get('paths', [])))
    report.field('Physical coordinate frame', 'RAS millimetres')
    source = document.get('source_volume') or {}
    report.field('Source identity verification', source.get('verification_status'))
    report.field('Source voxel spacing in mm', source.get('spacing_mm'))
    report.field('Source orientation', source.get('orientation'))
    report.field('Inference input dimensions', source.get('inference_grid'))
    report.field('Preprocessing version', (document.get('preprocessing') or {}).get('version'))
    report.field('Predicted connected components', (geometry or {}).get('component_count'))
    figure_captions = document.get('figure_captions', {})
    def figure_block(name, width, max_height):
        figure = Image(BytesIO(artifacts[name]))
        scale = min(width / figure.imageWidth, max_height / figure.imageHeight)
        figure.drawWidth = figure.imageWidth * scale
        figure.drawHeight = figure.imageHeight * scale
        return [figure, Paragraph(escape(figure_captions[name]), report.body)]

    def figure_row(names):
        names = [name for name in names if name in figure_captions]
        if names:
            width = 480 / len(names)
            report.story.append(Table([[figure_block(name, width - 12, 160) for name in names]],
                                      colWidths=[width] * len(names)))

    if any(name.startswith('images/source_axis_') for name in figure_captions):
        report.section('Source-aligned segmentation overlays')
        figure_row([f'images/source_axis_{axis}.png' for axis in range(3)])
    if not figure_captions:
        report.paragraph('Source-aligned report figures were unavailable for this report version.')

    if any(name in figure_captions for name in ('images/3d_vessel_overview.png', 'images/cpr_selected_path.png')):
        report.story.append(PageBreak())
        report.section('Vessel geometry and localization')
        report.paragraph('The oblique volume view and the curved planar reformation (CPR) use the saved predicted mask and the selected saved path.')
        for name in ('images/3d_vessel_overview.png', 'images/cpr_selected_path.png'):
            if name in figure_captions:
                report.story.append(KeepTogether(figure_block(name, 420, 255 if 'vessel' in name else 165)))

    report.story.append(PageBreak())
    report.section('Candidate measurements')
    data = [[cell(value, report.table_header) for value in ['Candidate', 'Min / ref diameter', 'Diameter narrowing', 'Min / ref area', 'Area narrowing', 'Severity']]]
    def number(value, suffix=''):
        return 'Unavailable' if value is None else f'{value:.2f}{suffix}'

    for candidate in candidates:
        data.append([cell(candidate['id']+' / '+candidate['path_id']),
            cell(f"{candidate['minimum_diameter_mm']:.2f} / {candidate['reference_diameter_mm']:.2f} mm"),
            cell(f"{candidate['narrowing_percent']:.2f}%"),
            cell(f"{number(candidate.get('minimum_area_mm2'))} / {number(candidate.get('reference_area_mm2'))} mm²"),
            cell(number(candidate.get('area_narrowing_percent'), '%')), cell((candidate.get('severity') or 'Grade withheld').capitalize())])
    if candidates:
        report.story.append(Table(data, colWidths=[74,102,78,105,70,65], repeatRows=1,
            style=TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eaf0f5')),('GRID',(0,0),(-1,-1),.5,colors.HexColor('#ccd8e4')),('VALIGN',(0,0),(-1,-1),'TOP'),('PADDING',(0,0),(-1,-1),6)])))
    else:
        report.paragraph('Unavailable — no candidate passed the recorded geometry rules.')
    if candidates:
        report.paragraph('Equivalent diameters are derived from perpendicular cross-sectional area. The reference uses recorded proximal and distal sections on the same path.')
        lead = candidates[0]
        sections = lead.get('cross_sections') or []
        if sections:
            report.section(f"{lead['id']} / {lead['path_id']} perpendicular lumen sections")
            figure_row([f'images/lumen_section_{index}.png' for index in range(3)])
            for role, section in zip(('Minimum', 'Proximal reference', 'Distal reference'), sections):
                coords = section.get('center_ras_mm')
                report.field(f'{role} RAS mm', ', '.join(f'{value:.2f}' for value in coords) if coords else None)
    estimates = (geometry or {}).get('exploratory_estimates') or []
    if estimates:
        report.section('Exploratory lumen estimates by path (research demonstration)')
        rows = [[cell(value, report.table_header) for value in ['Path', 'MLD / RVD', 'Narrowing', 'Research band', 'Length', 'Candidate status']]]
        for row in estimates:
            rows.append([cell(row['path_id']), cell(f"{row['minimum_diameter_mm']:.2f} / {row['reference_diameter_mm']:.2f} mm"),
                cell(f"{row['narrowing_percent']:.1f}%"), cell(str(row['research_band']).capitalize()), cell(f"{row['length_mm']:.1f} mm"),
                cell(f"Eligible ({row['eligible_candidate']})" if row.get('eligible_candidate') else str(row.get('withheld_reason') or '').replace('_', ' '))])
        report.story.append(Table(rows, colWidths=[44,104,66,78,58,144], repeatRows=1,
            style=TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#f1ecfb')),('GRID',(0,0),(-1,-1),.5,colors.HexColor('#ccd8e4')),('VALIGN',(0,0),(-1,-1),'TOP'),('PADDING',(0,0),(-1,-1),5)])))
        report.paragraph('MLD is the narrowest predicted-mask width along each path and RVD the median width elsewhere on the same path. These exploratory estimates are shown for research demonstration and are not eligible, validated measurements.')

    report.story.append(PageBreak())
    report.section('Explainable AI — Research Interpretation')
    xai = document.get('explainable_ai') or []
    if not xai:
        report.paragraph('XAI not generated: no volumetric explanation was saved for this run.')
    else:
        rows = [[cell(value, report.table_header) for value in ['Method', 'Status', 'Native alignment', 'Energy in target', 'Deletion', 'Insertion']]]
        for item in xai:
            v, a, summary = item.get('verification') or {}, item.get('alignment') or {}, item.get('summary') or {}
            energy = summary.get('energy_inside_target_mask')
            rows.append([cell(item.get('method_label', '')), cell(str(item.get('status', '')).replace('_', ' ')),
                         cell(f"{a.get('status', 'NOT_TESTED')} (Dice {a.get('mask_dice_vs_saved', '-')})"),
                         cell('—' if energy is None else f'{energy * 100:.1f}%'),
                         cell(v.get('deletion', 'NOT_TESTED')), cell(v.get('insertion', 'NOT_TESTED'))])
        report.story.append(Table(rows, colWidths=[96, 60, 110, 70, 60, 60], repeatRows=1,
            style=TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#f4f4f5')),('GRID',(0,0),(-1,-1),.5,colors.HexColor('#d4d4d8')),('VALIGN',(0,0),(-1,-1),'TOP'),('PADDING',(0,0),(-1,-1),5)])))
        for item in xai:
            target = item.get('target') or {}
            report.field(item.get('method_label') or 'Attribution target', target.get('definition') or target.get('target_id'))
            report.field('Model randomization', (item.get('verification') or {}).get('randomization'))
            name = f"images/xai_{item['id']}_axis_2.png"
            if name in figure_captions:
                report.story.append(KeepTogether(figure_block(name, 420, 250)))
        report.paragraph('Attribution describes sensitivity of the saved segmentation target. Lesion severity requires separate evidence.')

    if document.get('reference_evaluations'):
        reference = document['reference_evaluations'][-1]
        report.section('Case reference mask evaluation')
        report.paragraph('Reviewer-supplied reference on the original source grid; independent clinical validation is not established.')
        report.field('Reference evaluation', reference['id'])
        for key, label in [('dice','Dice'),('iou','IoU'),('hd95','HD95 mm'),('assd','ASSD mm')]:
            report.field(label, reference['metrics'].get(key))
        report.paragraph(reference['provenance'])
    else:
        report.section('Case reference mask evaluation')
        report.paragraph('Case-level overlap and distance metrics are unavailable. No matched reference evaluation is saved in this report.')

    report.story.append(PageBreak())
    report.section('Methods, limitations and review')
    report.field('Measurement mask version', (document.get('segmentation') or {}).get('measurement_mask_version'))
    report.field('Saved reviewer mask versions', len(document.get('mask_review_versions') or []))
    report.field('Geometry method', (geometry or {}).get('method'))
    report.field('Diameter definition', 'Area-equivalent perpendicular lumen section')
    if candidates:
        report.field('Research severity protocol', candidates[0].get('protocol_id'))
        report.paragraph('Research category boundaries are 25%, 50% and 70% diameter narrowing. Grade is withheld when sensitivity crosses a boundary.')
        for candidate in candidates:
            if candidate.get('abstention_reasons'):
                report.field(f"{candidate['id']} grade withheld", ', '.join(candidate['abstention_reasons']))
    if identity:
        report.field('Source SHA-256', document.get('source_sha256'))
        report.field('Snapshot SHA-256', document.get('snapshot_sha256'))
        report.field('Source-grid mask SHA-256', (document.get('segmentation') or {}).get('mask_sha256'))
        report.field('Report schema', document.get('schema_version'))
    review = document.get('human_assessment') or {}
    if review.get('current'):
        report.field('Human review', f"{len(review['current'])} path(s) reviewed · {review.get('edits_recorded')} edit(s) recorded")
        rows = [[cell(value, report.table_header) for value in ['Path', 'Decision', 'Artery', 'Reviewer min / ref', 'Narrowing', 'Reviewed']]]
        for row in review['current']:
            measured = row.get('measurement') or {}
            rows.append([cell(row['path_id']), cell(row['decision'].capitalize()), cell((row.get('artery') or '—').replace('_', ' ')),
                         cell(f"{measured['minimum_diameter_mm']:.2f} / {measured['reference_diameter_mm']:.2f} mm" if measured else '—'),
                         cell(f"{measured['narrowing_percent']:.1f}%" if measured else '—'),
                         cell(f"{row.get('reviewer_role', '')} · {str(row.get('reviewed_at', ''))[:10]}")])
        report.story.append(Table(rows, colWidths=[40, 62, 80, 110, 62, 140], repeatRows=1,
            style=TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#f4f4f5')),('GRID',(0,0),(-1,-1),.5,colors.HexColor('#d4d4d8')),('VALIGN',(0,0),(-1,-1),'TOP'),('PADDING',(0,0),(-1,-1),5)])))
        report.paragraph('Reviewer edits are recorded beside the model output, which is unchanged. Reviewer diameters are computed by the server at the reviewer-placed markers on the predicted mask, so they are not independent of the model.')
    else:
        report.field('Human review', 'No reviewer geometry edits recorded')
    for limitation in dict.fromkeys([*((geometry or {}).get('limitations') or []), *(document.get('limitations') or [])]):
        report.paragraph('- ' + limitation)
    report.paragraph('The saved vessel mask is a research prediction. Fragmentation, coarse resolution and segmentation error can affect every derived measurement. See JSON and CSV exports for full-precision geometry, hashes and stage notes.')
    return report.build()
