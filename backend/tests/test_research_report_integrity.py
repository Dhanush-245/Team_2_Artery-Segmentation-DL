from io import BytesIO

from pypdf import PdfReader

from app.research_reporting import pdf_bytes, primary_candidate_rows, tabular


def abstained_snapshot():
    candidates = [
        {'candidate_id': candidate_id, 'model_score': score}
        for candidate_id, score in [('C1', .629), ('C2', .296), ('C3', .258)]
    ]
    records = []
    for candidate, narrowing, grade in [('C1', 15.02, 'minimal'), ('C2', 17.54, 'minimal'), ('C3', 27.89, 'mild')]:
        records.append({
            'candidate_id': candidate,
            'status': 'experimental_mask_estimate',
            'quality_status': 'exploratory_only_quality_gate_failed',
            'eligible_for_reference_validation': False,
            'minimum_diameter': 7.2,
            'reference_diameter': 10,
            'narrowing_percent': narrowing,
            'severity': {'category': grade},
            'cross_section_assessment': {'status': 'abstained', 'reasons': ['low_local_boundary_contrast']},
        })
    return {
        'report_id': 'report-8', 'version': 8, 'generated_at': '2026-11-14T12:24:54+00:00',
        'sections': ['images', 'measurements', 'candidates', 'review'],
        'case': {'id': 'case', 'case_code': 'FINAL-2D-DEMO', 'modality': 'XCA', 'anatomy': 'coronary'},
        'image': {'id': 'image', 'original_name': 'study.png', 'width': 300, 'height': 300},
        'analysis': {'id': 'run', 'model_version': 'model-v1', 'artery_pixels': 8662, 'stenosis_pixels': 2405,
            'vessel_analysis': {'diameter_unit': 'px', 'quality_flags': []},
            'structured_result': {'candidates': candidates}},
        'automatic_measurements': [{'id': 'latest', 'records': records,
            'protocol_authorization': {'protocol_id': 'research-protocol', 'protocol_version': '1', 'status': 'researcher_authorized'},
            'measurement_method': {'id': 'saved-run-cross-sections'}}],
        'reviewed_stenosis_measurements': [], 'human_review': None, 'image_panels': [],
        'limitations': [], 'provenance': {},
    }


def test_abstained_exploratory_values_never_become_primary_grades():
    snapshot = abstained_snapshot()
    rows = primary_candidate_rows(snapshot)
    assert [row['status'] for row in rows] == ['Abstained'] * 3
    assert all(row['narrowing_percent'] is None and row['severity'] is None for row in rows)
    assert {row['reason'] for row in rows} == {'Insufficient local vessel boundary contrast'}

    pdf = pdf_bytes(snapshot, [])
    reader = PdfReader(BytesIO(pdf))
    text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    assert len(reader.pages) == 5
    assert 'All primary quantitative assessments abstained' in text
    assert text.count('Indeterminate') >= 3
    assert 'Exploratory mask-width result: 15.02%, minimal category' in text
    assert 'Exploratory mask-width result: 17.54%, minimal category' in text
    assert 'Exploratory mask-width result: 27.89%, mild category' in text
    assert 'no accepted automatic severity category is available' in text
    assert 'Insufficient local vessel boundary contrast' in text
    assert 'Minimum / reference' in text
    assert 'indeterminate' in tabular(snapshot)
