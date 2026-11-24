"""Automatic alerts: severe research-grade findings, 3D completion and failure."""
import json
from uuid import uuid4

import nibabel as nib
import numpy as np
from fastapi.testclient import TestClient

from app.main import STORAGE, app, severe_automatic_candidates
from test_rbac_system import make_user

SPACING = .5


def test_severe_candidates_are_found_in_2d_and_3d_records_but_not_when_abstained():
    records_2d = [
        {"candidate_id": "C1", "status": "measured", "severity": {"category": "Severe"}},
        {"candidate_id": "C2", "status": "measured", "severity": {"category": "Critical"}},
        {"candidate_id": "C3", "status": "measured", "severity": {"category": "Moderate"}},
        {"candidate_id": "C4", "status": "abstained", "severity": {"category": "Severe"}},
        {"candidate_id": "C5", "status": "measured", "severity": {"category": None}},
    ]
    assert severe_automatic_candidates(records_2d) == ["C1", "C2"]
    assert severe_automatic_candidates([{"id": "C1", "severity": "severe"}, {"id": "C2", "severity": "mild"}, {"id": "C3", "severity": None}]) == ["C1"]
    assert severe_automatic_candidates(None) == [] and severe_automatic_candidates(["x", 3]) == []


def _tube(radius_middle):
    shape = (40, 40, 100)
    i, j, k = np.meshgrid(*[np.arange(n) for n in shape], indexing='ij')
    radial = np.hypot((i - 20) * SPACING, (j - 20) * SPACING)
    along = k * SPACING
    radius = np.where(np.abs(along - 25) < 2, radius_middle, 2.5)
    return ((radial <= radius) & (along >= 5) & (along <= 45)).astype(np.uint8)


def _queued_run(client, owner, mask=None):
    from app.database import SessionLocal
    from app.models import VolumeAnalysis
    case = client.post('/api/cases', headers=owner, json={'case_code': 'SEV-' + uuid4().hex[:6], 'modality': 'CTA', 'anatomy': 'coronary'}).json()
    me = client.get('/api/auth/me', headers=owner).json()
    with SessionLocal() as db:
        row = VolumeAnalysis(case_id=case['id'], created_by=me['id'], status='queued', source_sha256='0' * 64, model_key='imagecas', input_kind='medical_study')
        db.add(row); db.commit()
        run_id = row.id
    folder = STORAGE / 'volumes' / run_id
    (folder / 'outputs').mkdir(parents=True, exist_ok=True)
    image = nib.Nifti1Image(np.ones((40, 40, 100), dtype=np.int16), np.diag([SPACING, SPACING, SPACING, 1.]))
    nib.save(image, str(folder / 'source.nii.gz'))
    return case, run_id, folder


def _fake_inference(mask):
    def run(source, out_dir, *args):
        image = nib.Nifti1Image(mask, np.diag([SPACING, SPACING, SPACING, 1.]))
        image.header.set_xyzt_units('mm')
        nib.save(image, str(out_dir / 'mask_source.nii.gz'))
        return {'checkpoint_sha256': 'x', 'model_id': 'imagecas-test', 'source_shape': list(mask.shape)}
    return run


def _grade(monkeypatch, band):
    """The geometry code has its own tests; here only the alert hook is under test, so fix the measured band."""
    import app.volume_measurements as volume_measurements
    monkeypatch.setattr(volume_measurements, 'saved_measurement', lambda path: {'candidates': [{'id': 'C1', 'severity': band}]})


def _alerts(client, headers):
    return {item['kind']: item for item in client.get('/api/notifications', headers=headers).json()}


def test_3d_analysis_with_a_severe_narrowing_raises_a_high_level_alert(monkeypatch):
    import app.main as main
    import app.volume_inference as volume_inference
    with TestClient(app) as client:
        _, owner = make_user(f'sev-owner-{uuid4().hex}@example.org', 'researcher')
        case, run_id, folder = _queued_run(client, owner)
        monkeypatch.setattr(volume_inference, 'run_inference', _fake_inference(_tube(1.25)))
        _grade(monkeypatch, 'severe')
        main._execute_volume_analysis(run_id)
        alerts = _alerts(client, owner)
        assert 'model_severe_flag' in alerts, sorted(alerts)
        assert alerts['model_severe_flag']['alert_level'] == 'high'
        assert 'Unvalidated' in alerts['model_severe_flag']['message'] and case['case_code'] in alerts['model_severe_flag']['message']


def test_3d_analysis_without_a_severe_narrowing_does_not_raise_the_severe_alert(monkeypatch):
    import app.main as main
    import app.volume_inference as volume_inference
    with TestClient(app) as client:
        _, owner = make_user(f'mild-owner-{uuid4().hex}@example.org', 'researcher')
        _, run_id, _ = _queued_run(client, owner)
        monkeypatch.setattr(volume_inference, 'run_inference', _fake_inference(_tube(2.0)))
        _grade(monkeypatch, 'mild')
        main._execute_volume_analysis(run_id)
        assert 'model_severe_flag' not in _alerts(client, owner)


def test_3d_failure_notifies_the_requester_at_high_level(monkeypatch):
    import app.main as main
    import app.volume_inference as volume_inference

    def boom(*args, **kwargs):
        raise RuntimeError('simulated failure')
    with TestClient(app) as client:
        _, owner = make_user(f'fail-owner-{uuid4().hex}@example.org', 'researcher')
        _, run_id, _ = _queued_run(client, owner)
        monkeypatch.setattr(volume_inference, 'run_inference', boom)
        main._execute_volume_analysis(run_id)
        alert = _alerts(client, owner).get('analysis_failed')
        assert alert is not None and alert['alert_level'] == 'high'
        assert 'simulated' not in json.dumps(alert)
