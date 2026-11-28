from fastapi.testclient import TestClient
from app.main import app
from test_rbac_system import make_user

SHAPE = {"runs_2d", "runs_3d", "total_runs", "latest_model", "latest_run_at", "reports_saved"}


def test_every_new_case_carries_the_same_analysis_summary_whatever_its_modality():
    with TestClient(app) as client:
        _, owner = make_user("summary-owner@example.org", "researcher")
        xca = client.post("/api/cases", headers=owner, json={"case_code": "SUM-XCA", "modality": "XCA", "anatomy": "coronary"})
        cta = client.post("/api/cases", headers=owner, json={"case_code": "SUM-CTA", "modality": "CTA", "anatomy": "coronary",
                                                             "intended_task": "volume_preparation"})
        assert xca.status_code == 201 and cta.status_code == 201, (xca.text, cta.text)
        for created in (xca.json(), cta.json()):
            assert set(created["analysis_summary"]) == SHAPE
            assert created["analysis_summary"]["total_runs"] == 0
            assert created["analysis_summary"]["latest_model"] is None
        listed = client.get("/api/cases", headers=owner).json()
        assert all(set(item["analysis_summary"]) == SHAPE for item in listed)
