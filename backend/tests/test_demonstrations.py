from app.demonstrations import suite
from fastapi.testclient import TestClient
from app.main import app
from test_rbac_system import make_user
from app.database import Base, engine


def test_demonstration_suite_runs_real_algorithms_without_training():
    result = suite()
    assert result["mode"] == "DEMONSTRATION"
    assert result["training_performed"] is False
    assert result["scientific_validation"] == "NOT_INDEPENDENTLY_VALIDATED"
    assert result["clinical_validation"] == "NOT_ESTABLISHED"
    assert result["summary"] == {"total": 8, "passed": 8}
    assert len(result["evidence_sha256"]) == 64


def test_demonstration_endpoint_is_authenticated():
    Base.metadata.create_all(bind=engine)
    _, headers = make_user("demonstration-reader@example.org", "researcher")
    with TestClient(app) as client:
        assert client.get("/api/demonstrations").status_code == 401
        response = client.get("/api/demonstrations", headers=headers)
        assert response.status_code == 200
        assert response.json()["summary"]["passed"] == 8
        manifest = client.get("/api/demonstrations/manifest", headers=headers)
        assert manifest.status_code == 200
        assert manifest.headers["content-disposition"].endswith('"corovision-demonstration-manifest.json"')
        assert manifest.json()["evidence_sha256"] == response.json()["evidence_sha256"]


def test_uncertain_boundary_and_disconnected_mask_abstain():
    result = suite()["sections"]
    uncertain = next(row for row in result["severity_boundaries"] if row["id"] == "uncertain-boundary")
    assert uncertain["actual"]["research_category"] is None
    assert uncertain["actual"]["status"] == "indeterminate"
    fragmented = next(row for row in result["three_dimensional_quality"] if row["id"] == "disconnected-tube")
    assert fragmented["actual"]["measurement_eligibility"] == "abstained"
    assert fragmented["actual"]["reasons"] == ["disconnected_prediction"]
