from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app
from test_rbac_system import make_user


def test_evidence_requires_auth_and_keeps_aggregate_scientific_limits():
    with TestClient(app) as client:
        assert client.get('/api/models/evidence-status').status_code == 401
        for role in ('viewer', 'researcher', 'doctor', 'admin', 'ml_engineer', 'technician', 'clinician'):
            _, headers = make_user(f'evidence-{uuid4().hex}@example.org', role)
            response = client.get('/api/models/evidence-status', headers=headers)
            assert response.status_code == 200
            data = response.json()
            external = data['external_evaluation']
            assert external['cases'] == 40 and not external['clinical_validated']
            assert not external['patient_independence_established']
            assert external['cohorts']['All']['metrics']['dice']['support'] == 40
            assert external['cohorts']['All']['metrics']['hd95']['support'] == 39
            assert external['cohorts']['Diseased']['metrics']['hd95']['support'] == 19
            assert 0.3572 < external['cohorts']['All']['metrics']['dice']['mean'] < 0.3574
            assert external['empty_predictions'] == 1
            assert not external['stenosis']['expert_confirmed']
            assert len(data['acceptance']) == 8
            assert all(private not in response.text for private in ('/Users/', 'reviewer_id', 'case_id', 'reference_file', 'source_sha256'))
