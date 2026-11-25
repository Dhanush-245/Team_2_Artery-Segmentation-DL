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
                document['severity_status'] = 'experimental_research_grade'
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
    writer.writerow(['case_id', 'analysis_run_id', 'model_id', 'checkpoint_sha256', 'stage', 'status', 'reason'])
    def safe(value):
        text = '' if value is None else str(value)
        return "'" + text if text.startswith(('=', '+', '-', '@', '\t', '\r')) else text
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


def pdf_bytes(document):
    from reportlab.lib import colors
    from reportlab.platypus import PageBreak, Paragraph, Table, TableStyle

    report = ResearchPDF('3D vessel analysis report')
    geometry = document.get('experimental_geometry')
    candidates = (geometry or {}).get('candidates', [])

    def cell(value, style=None):
        return Paragraph(str(value), style or report.table_body)

    report.story.append(Paragraph('COROVISION AI · 3D RESEARCH ANALYSIS', report.eyebrow))
    summary = Table([
        [cell('Case', report.table_label), cell(document['case_id']), cell('Model', report.table_label), cell(document['model_id'])],
        [cell('Analysis run', report.table_label), cell(document['analysis_run_id']), cell('Study type', report.table_label), cell((document.get('input_kind') or 'Unavailable').replace('_', ' ').capitalize())],
        [cell('Source volume', report.table_label), cell(' × '.join(map(str, document.get('source_shape') or [])) + ' voxels'), cell('Candidates', report.table_label), cell(len(candidates))],
    ], colWidths=[70, 174, 78, 172], style=TableStyle([('GRID',(0,0),(-1,-1),.5,colors.HexColor('#ccd8e4')),('VALIGN',(0,0),(-1,-1),'TOP'),('PADDING',(0,0),(-1,-1),7)]))
    report.story.append(summary)
    if document.get('reference_evaluations'):
        reference = document['reference_evaluations'][-1]
        report.section('Case reference mask evaluation')
        report.paragraph('Reviewer-supplied reference on the original source grid; independent clinical validation is not established.')
        report.field('Reference evaluation', reference['id'])
        for key, label in [('dice','Dice'),('iou','IoU'),('hd95','HD95 mm'),('assd','ASSD mm')]:
            report.field(label, reference['metrics'].get(key))
        report.paragraph(reference['provenance'])
    report.section('Analysis summary')
    if candidates:
        first = candidates[0]
        report.paragraph(f"{len(candidates)} experimental narrowing candidate(s) were identified from component-local saved-mask geometry. The leading candidate has {first['narrowing_percent']:.2f}% diameter narrowing and an experimental {first['severity']} category. Expert review is required.")
    else:
        report.paragraph('No quality-eligible 3D narrowing candidate is available. No normal finding is inferred.')
    report.field('Segmentation', document['stages']['segmentation']['status'].replace('_',' ').capitalize())
    report.field('Severity readiness', document['stages']['severity']['status'].replace('_',' ').capitalize())
    report.paragraph('Research use only. This document is not a clinical diagnostic report.')

    report.story.append(PageBreak())
    report.section('Volume geometry and localization')
    report.field('Source dimensions', ' × '.join(map(str, document.get('source_shape') or [])) + ' voxels')
    report.field('Predicted coarse-grid foreground', document.get('predicted_coarse_foreground_voxels'))
    report.field('Extracted centerline paths', len((geometry or {}).get('paths', [])))
    report.field('Physical coordinate frame', 'RAS millimetres')
    report.paragraph('Axial, sagittal and coronal saved previews and the interactive vessel reconstruction are available in the application and evidence artifacts. No absent visualization is synthesized in this PDF.')

    report.story.append(PageBreak())
    report.section('Candidate measurements')
    data = [[cell(value, report.table_header) for value in ['Candidate', 'Min / ref diameter', 'Diameter narrowing', 'Min / ref area', 'Area narrowing', 'Severity']]]
    for candidate in candidates:
        data.append([cell(candidate['id']+' / '+candidate['path_id']),
            cell(f"{candidate['minimum_diameter_mm']:.2f} / {candidate['reference_diameter_mm']:.2f} mm"),
            cell(f"{candidate['narrowing_percent']:.2f}%"),
            cell(f"{candidate.get('minimum_area_mm2', 0):.2f} / {candidate.get('reference_area_mm2', 0):.2f} mm2"),
            cell(f"{candidate.get('area_narrowing_percent', 0):.2f}%"), cell(str(candidate['severity']).capitalize())])
    if candidates:
        report.story.append(Table(data, colWidths=[74,102,78,105,70,65], repeatRows=1,
            style=TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eaf0f5')),('GRID',(0,0),(-1,-1),.5,colors.HexColor('#ccd8e4')),('VALIGN',(0,0),(-1,-1),'TOP'),('PADDING',(0,0),(-1,-1),6)])))
    else:
        report.paragraph('Unavailable — no candidate passed the recorded geometry rules.')
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
        report.paragraph('Target: mean vessel-minus-background logit over the voxels the 3D model labels as vessel at 128³, explained at '
                         'decoder block dec[1] and restored to the native grid through the saved mask transform. Attribution shows where that '
                         'segmentation output was sensitive; it is not a lesion label, narrowing or disease probability. Model randomization was '
                         'checked once, on the public demo case only (Grad-CAM 3D partial, Grad-CAM++ 3D fail).')

    report.story.append(PageBreak())
    report.section('Methods, limitations and review')
    report.field('Geometry method', (geometry or {}).get('method'))
    report.field('Diameter definition', 'Area-equivalent perpendicular lumen section')
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
