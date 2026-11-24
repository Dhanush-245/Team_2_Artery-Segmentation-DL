"""The architecture comparison shown in Model Evaluation (module 10 and 16)."""
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from test_rbac_system import make_user

VALID_STATUS = {"release", "legacy", "rejected", "candidate"}
RELEASE = json.loads((Path(__file__).resolve().parents[2] / "ml" / "releases" / "corovision_20261023.json").read_text())


def _body():
    with TestClient(app) as client:
        assert client.get("/api/models/comparison").status_code == 401
        _, viewer = make_user(f"cmp-viewer-{uuid4().hex}@example.org", "viewer")
        assert client.get("/api/models/comparison", headers=viewer).status_code == 403
        _, ml = make_user(f"cmp-ml-{uuid4().hex}@example.org", "ml_engineer")
        response = client.get("/api/models/comparison", headers=ml)
        assert response.status_code == 200
        return response.json()


def test_comparison_covers_the_architectures_and_keeps_tasks_separate():
    body = _body()
    assert {task["id"] for task in body["tasks"]} == {"artery_2d", "stenosis_2d", "volume_3d"}
    names = " ".join(row["name"] for task in body["tasks"] for row in task["rows"])
    for expected in ("Tiny U-Net", "Attention U-Net", "ResNet34 U-Net", "Mask R-CNN", "3D U-Net"):
        assert expected in names
    assert any("never rank across tasks" in rule for rule in body["rules"])
    assert "U-Net++" in body["not_implemented"] and "TransUNet" in body["not_implemented"]


def test_every_row_has_a_status_sources_and_sane_numbers():
    for task in _body()["tasks"]:
        statuses = [row["status"] for row in task["rows"]]
        assert statuses.count("release") == 1, task["id"]
        assert len(task["rows"]) >= 2 and "rejected" in statuses
        for row in task["rows"]:
            assert row["status"] in VALID_STATUS and row["source"] and row["note"] and row["aggregation"]
            assert set(row["metrics"]) <= set(task["metric_keys"]), (task["id"], row["name"])
            for key, value in row["metrics"].items():
                assert value > 0, (row["name"], key)
                if key not in {"hd95", "assd", "fp_per_image"}:
                    assert value <= 1, (row["name"], key)


def test_release_rows_match_the_pinned_release_manifest():
    tasks = {task["id"]: task for task in _body()["tasks"]}
    by_task = {model["task"]: model for model in RELEASE["models"]}
    artery = next(row for row in tasks["artery_2d"]["rows"] if row["status"] == "release")
    stenosis = next(row for row in tasks["stenosis_2d"]["rows"] if row["status"] == "release")
    assert abs(artery["metrics"]["dice"] - by_task["syntax"]["validation_dice"]) < 1e-3
    assert abs(artery["metrics"]["iou"] - by_task["syntax"]["validation_iou"]) < 1e-3
    assert abs(stenosis["metrics"]["dice"] - by_task["stenosis"]["validation_dice"]) < 1e-3
    assert abs(stenosis["metrics"]["iou"] - by_task["stenosis"]["validation_iou"]) < 1e-3


def test_candidates_that_were_tuned_on_validation_say_so():
    rows = [row for task in _body()["tasks"] for row in task["rows"] if row["status"] == "candidate"]
    assert rows and all("validation" in row["note"].lower() and "not connected" in row["note"].lower() for row in rows)
