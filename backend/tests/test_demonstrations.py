from app.demonstrations import suite
from fastapi.testclient import TestClient
from app.main import app
from test_rbac_system import make_user
from app.database import Base, engine
import io
import json
import zipfile


def test_demonstration_suite_runs_real_algorithms_without_training():
    result = suite()
    assert result["mode"] == "DEMONSTRATION"
    assert result["training_performed"] is False
    assert result["scientific_validation"] == "NOT_INDEPENDENTLY_VALIDATED"
    assert result["clinical_validation"] == "NOT_ESTABLISHED"
    assert result["summary"] == {"total": 9, "passed": 9}
    assert len(result["evidence_sha256"]) == 64


def test_demonstration_endpoint_is_authenticated():
    Base.metadata.create_all(bind=engine)
    _, headers = make_user("demonstration-reader@example.org", "researcher")
    with TestClient(app) as client:
        assert client.get("/api/demonstrations").status_code == 401
        response = client.get("/api/demonstrations", headers=headers)
        assert response.status_code == 200
        assert response.json()["summary"]["passed"] == 9
        manifest = client.get("/api/demonstrations/manifest", headers=headers)
        assert manifest.status_code == 200
        assert manifest.headers["content-disposition"].endswith('"corovision-demonstration-manifest.json"')
        assert manifest.json()["evidence_sha256"] == response.json()["evidence_sha256"]
        package = client.get("/api/demonstrations/package", headers=headers)
        assert package.status_code == 200
        with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
            assert set(archive.namelist()) == {"manifest.json", "README.txt", "SHA256SUMS.txt"}
            assert json.loads(archive.read("manifest.json"))["summary"] == {"total": 9, "passed": 9}
            assert b"not clinical validation" in archive.read("README.txt")


def test_uncertain_boundary_and_disconnected_mask_abstain():
    result = suite()["sections"]
    uncertain = next(row for row in result["severity_boundaries"] if row["id"] == "uncertain-boundary")
    assert uncertain["actual"]["research_category"] is None
    assert uncertain["actual"]["status"] == "indeterminate"
    fragmented = next(row for row in result["three_dimensional_quality"] if row["id"] == "disconnected-tube")
    assert fragmented["actual"]["measurement_eligibility"] == "abstained"
    assert fragmented["actual"]["reasons"] == ["disconnected_prediction"]
    focal = next(row for row in result["three_dimensional_quality"] if row["id"] == "focal-narrowing-tube")
    assert focal["actual"]["research_category"] == "Mild"
    assert focal["absolute_error_percentage_points"] < 3
