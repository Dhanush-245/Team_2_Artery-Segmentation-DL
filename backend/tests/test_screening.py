"""Normal-versus-abnormal screening label derived from the detector output."""
from app.screening import LIMITATIONS, MIN_ARTERY_PIXELS, SCREENING_SCORE_THRESHOLD, screening_from_result


def _result(*scores, flags=()):
    return {'candidates': [{'candidate_id': f'C{i + 1}', 'model_score': score} for i, score in enumerate(scores)],
            'quality': {'flags': [{'code': code} for code in flags]}}


def test_a_candidate_at_the_operating_point_flags_the_study():
    shown = screening_from_result(_result(0.72, 0.34, 0.10), artery_pixels=6000)
    assert shown['label'] == 'abnormal_flagged' and shown['display'].startswith('Abnormal')
    assert shown['basis']['flagged_candidates'] == ['C1', 'C2'] and shown['basis']['max_score'] == 0.72
    assert screening_from_result(_result(SCREENING_SCORE_THRESHOLD), artery_pixels=6000)['label'] == 'abnormal_flagged'
    assert screening_from_result(_result(SCREENING_SCORE_THRESHOLD - 0.001), artery_pixels=6000)['label'] == 'not_flagged'


def test_no_candidate_is_not_flagged_but_never_called_normal():
    shown = screening_from_result(_result(), artery_pixels=6000)
    assert shown['label'] == 'not_flagged' and 'normal' not in shown['display'].lower()
    assert shown['basis']['candidates'] == 0 and 'does not establish a normal vessel' in shown['limitations']
    assert shown['clinical_validated'] is False and shown['limitations'] == LIMITATIONS


def test_weak_segmentation_or_unstable_scores_make_a_miss_indeterminate():
    assert screening_from_result(_result(), artery_pixels=MIN_ARTERY_PIXELS - 1)['label'] == 'indeterminate'
    assert screening_from_result(_result(0.1, flags=['low_foreground_score']), artery_pixels=6000)['label'] == 'indeterminate'
    assert screening_from_result(_result(flags=['uncertain_pixels']), artery_pixels=6000)['label'] == 'indeterminate'
    # A flagged candidate stays flagged even when the image is uncertain: the reviewer must look.
    assert screening_from_result(_result(0.6, flags=['uncertain_pixels']), artery_pixels=6000)['label'] == 'abnormal_flagged'


def test_missing_or_odd_inputs_do_not_raise():
    assert screening_from_result(None)['label'] == 'not_flagged'
    assert screening_from_result({'candidates': ['x', None, {'candidate_id': 'C1', 'model_score': None}]})['label'] == 'not_flagged'
    assert screening_from_result({}, {'mask_pixels': 10})['label'] == 'indeterminate'


def test_saved_results_carry_the_screening_block():
    import json
    from datetime import datetime, timezone
    from app.main import event_out
    from app.models import AnalysisEvent
    structured = _result(0.72, 0.34)
    event = AnalysisEvent(id='e1', image_id='i1', model_version='v', artery_pixels=6321, stenosis_pixels=1895,
                          overlay_path='/nonexistent/overlay.png', created_at=datetime.now(timezone.utc),
                          validation_json=json.dumps({'structured_result': structured, 'vessel_analysis': {'mask_pixels': 6320}}))
    shown = event_out(event)['screening']
    assert shown['label'] == 'abnormal_flagged' and shown['basis']['flagged_candidates'] == ['C1', 'C2']
    # Runs saved before screening existed (no structured result) still get a label.
    old = AnalysisEvent(id='e2', image_id='i1', model_version='v', artery_pixels=6000, stenosis_pixels=0,
                        overlay_path='/nonexistent/o.png', created_at=datetime.now(timezone.utc), validation_json='{}')
    assert event_out(old)['screening']['label'] == 'not_flagged'
