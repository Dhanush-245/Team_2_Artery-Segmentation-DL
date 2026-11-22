"""Per-target model randomization: protocol fields, gate logic and frozen-model invariance (random stand-in weights)."""
import numpy as np
import pytest

torch = pytest.importorskip('torch')

from app import xai_engine, xai_randomization  # noqa: E402


@pytest.fixture()
def stand_in_models(monkeypatch, tmp_path):
    from app.preserved_models import PretrainedVesselUNet, build_detector
    torch.manual_seed(0)
    artery = PretrainedVesselUNet(False).eval()
    detector = build_detector('maskrcnn_resnet50_fpn', 2, pretrained=False).eval()
    rng = np.random.default_rng(3)
    gray = rng.random((512, 512), dtype=np.float32)
    color = np.repeat(gray[..., None], 3, axis=2)
    monkeypatch.setattr(xai_engine, '_models', lambda: (artery, detector))
    monkeypatch.setattr(xai_engine, '_load_inputs', lambda prepared: (color, gray))
    return artery, detector


def _snapshot(model):
    return {name: value.detach().clone() for name, value in model.state_dict().items()}


def _unchanged(model, before):
    return all(torch.equal(before[name], value) for name, value in model.state_dict().items())


def test_segmentation_randomization_reports_both_stages_and_leaves_the_frozen_model_untouched(stand_in_models, tmp_path):
    artery, _ = stand_in_models
    before = _snapshot(artery)
    saved = np.random.default_rng(1).random((512, 512)).astype(np.float32)
    result = xai_randomization.check(tmp_path / 'prepared.png', 'segmentation', 'gradcam', saved)
    assert result['randomization'] in {'PASS', 'FAIL', 'NOT_EVALUABLE'}
    assert [row['stage'] for row in result['randomization_stages']] == ['head', 'full']
    assert result['randomization_protocol'] == xai_randomization.PROTOCOL
    assert _unchanged(artery, before), 'the frozen checkpoint must never be modified'


def test_detector_randomization_binds_a_target_and_never_modifies_the_detector(stand_in_models, tmp_path):
    _, detector = stand_in_models
    before = _snapshot(detector)
    candidate = {'polygon_prepared_xy': [[200, 200], [260, 200], [260, 260], [200, 260]]}
    saved = np.random.default_rng(2).random((512, 512)).astype(np.float32)
    result = xai_randomization.check(tmp_path / 'prepared.png', 'stenosis', 'gradcampp', saved, candidate, constrained=False)
    assert {row['target_binding'] for row in result['randomization_stages']} <= {
        'matched_candidate', 'top_detection_fallback', 'no_foreground_detection'}
    assert result['randomization'] in {'PASS', 'FAIL', 'NOT_EVALUABLE'}
    assert _unchanged(detector, before)


def test_gate_logic_and_occlusion_is_not_tested(monkeypatch, stand_in_models, tmp_path):
    assert xai_randomization.check(tmp_path / 'p.png', 'segmentation', 'occlusion', None)['randomization'] == 'NOT_TESTED'
    saved = np.random.default_rng(4).random((512, 512)).astype(np.float32)
    # The same map as the "randomized" one gives rho = 1 -> FAIL; an unrelated map gives |rho| ~ 0 -> PASS.
    monkeypatch.setattr(xai_randomization, '_segmentation_map', lambda *a: (saved.copy(), 'run_vessel_pixels'))
    assert xai_randomization.check(tmp_path / 'p.png', 'segmentation', 'gradcam', saved)['randomization'] == 'FAIL'
    other = np.random.default_rng(5).random((512, 512)).astype(np.float32)
    monkeypatch.setattr(xai_randomization, '_segmentation_map', lambda *a: (other, 'run_vessel_pixels'))
    assert xai_randomization.check(tmp_path / 'p.png', 'segmentation', 'gradcam', saved)['randomization'] == 'PASS'
    monkeypatch.setattr(xai_randomization, '_segmentation_map', lambda *a: (np.zeros((512, 512), np.float32), 'run_vessel_pixels'))
    assert xai_randomization.check(tmp_path / 'p.png', 'segmentation', 'gradcam', saved)['randomization'] == 'NOT_EVALUABLE'
