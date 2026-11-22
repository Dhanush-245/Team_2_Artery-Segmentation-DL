"""Model versioning, dataset tracking and training history (brief modules 10 and 16)."""
from uuid import uuid4

from fastapi.testclient import TestClient

from app import trained_release
from app.evaluation_catalog import catalog
from app.main import app
from test_rbac_system import make_user


def test_catalog_serves_epoch_history_and_dataset_versions():
    data = catalog()
    assert data["capabilities"]["epoch_history"] is True
    for run in [r for r in data["runs"] if r["record_type"] == "imported_release_validation_report"]:
        assert len(run["training_history"]) >= 10
        first = run["training_history"][0]
        assert first["epoch"] == 1 and isinstance(first["train_loss"], float)
        assert run["dataset"]["train_images"] and run["dataset"]["validation_images"] == 200
        assert run["training_config"]


def test_registry_lists_versions_with_evidence_and_honest_rollback():
    suffix = uuid4().hex
    with TestClient(app) as client:
        assert client.get("/api/models/registry").status_code == 401
        _, viewer = make_user(f"reg-viewer-{suffix}@example.org", "viewer")
        assert client.get("/api/models/registry", headers=viewer).status_code == 403
        _, ml = make_user(f"reg-ml-{suffix}@example.org", "ml_engineer")
        body = client.get("/api/models/registry", headers=ml).json()
    versions = {v["version"]: v for v in body["versions"]}
    release = versions["corovision-preserved-2d-20261023"]
    assert release["active"] is trained_release.configured() and release["dimension"] == "2D"
    assert {m["task"] for m in release["models"]} == {"syntax", "stenosis"}
    assert all(len(m["checkpoint_sha256"]) == 64 for m in release["models"])
    assert release["datasets"] and release["evaluation_evidence"]["sha256"]
    assert any(v["dimension"] == "3D" for v in body["versions"])
    assert body["rollback"]["available"] is False and body["rollback"]["reason"]
