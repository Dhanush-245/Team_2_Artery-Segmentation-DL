"""Read-only model version registry: releases, datasets, evidence, architecture comparison and rollback status.

Nothing here activates, downloads or trains a model. Rollback is reported as
available only when a second verified release is actually installed.
"""
import json
from pathlib import Path

from fastapi import APIRouter, Depends

from . import trained_release
from .evaluation_catalog import RELEASES, _evidence, training_histories

COMPARISON = RELEASES / "model_comparison_20261124.json"

router = APIRouter(prefix="/api/models", tags=["Model registry"])


def _two_d_release():
    evidence, source = _evidence()
    histories = training_histories()
    release = trained_release.RELEASE
    models, datasets = [], []
    for model in release["models"]:
        history = histories.get(model["task"], {})
        models.append(dict(task=model["task"], architecture=model["architecture"], filename=model["filename"],
                           checkpoint_sha256=model["sha256"], threshold=model.get("threshold", model.get("score_threshold")),
                           validation_dice=model.get("validation_dice"), validation_iou=model.get("validation_iou"),
                           training_epochs=len(history.get("history", [])) or None,
                           metrics_recorded=[m["name"] for m in evidence.get(model["task"], {}).get("metrics", [])]))
        if history.get("dataset"):
            datasets.append({"task": model["task"], **history["dataset"]})
    return dict(version=release["version"], dimension="2D", modality="XCA", anatomy="coronary",
                active=trained_release.configured(), installed=trained_release.configured(),
                models=models, datasets=datasets, evaluation_evidence=source,
                manifest="ml/releases/corovision_20261023.json", limitations=release.get("limitations", []))


def _volume_release():
    path = RELEASES / "imagecas_3d_128.json"
    if not path.is_file():
        return None
    data = json.loads(path.read_text())
    installed = bool(__import__("os").environ.get("COROVISION_3D_CHECKPOINT"))
    return dict(version=data["model_id"], dimension="3D", modality=data.get("modality"), anatomy=data.get("anatomy"),
                active=installed, installed=installed,
                models=[dict(task=data["task"], architecture=data["architecture"], checkpoint_sha256=data["checkpoint_sha256"],
                             training_epochs=data.get("checkpoint_epoch"))],
                datasets=[dict(task=data["task"], name="ImageCAS")], evaluation_evidence=None,
                manifest=f"ml/releases/{path.name}", limitations=[data.get("status", "research")])


def registry():
    versions = [v for v in (_two_d_release(), _volume_release()) if v]
    installed_2d = [v for v in versions if v["dimension"] == "2D" and v["installed"]]
    return dict(versions=versions,
                rollback=dict(available=len(installed_2d) > 1,
                              reason=None if len(installed_2d) > 1 else
                              "Only one verified 2D release is installed; install a second hash-verified release to enable rollback."),
                research_only=True)


def comparison():
    """Curated side-by-side architecture evidence, grouped by task (see the file for sources and rules)."""
    return json.loads(COMPARISON.read_text())


def evidence_status():
    """Curated aggregate evidence only; never includes private data or case records."""
    data = json.loads((RELEASES / "evidence_status_20261126.json").read_text())
    development = _imagecas_development()
    if development:
        data["development_evaluation"] = development
    return data


def _imagecas_development():
    """ImageCAS validation record for the retained 3D model, read from the curated comparison file."""
    task = next((t for t in comparison().get("tasks", []) if t.get("id") == "volume_3d"), None)
    row = next((r for r in (task or {}).get("rows", []) if r.get("status") == "release"), None)
    if not row:
        return None
    return {"title": "ImageCAS development validation", "dataset": task.get("dataset"), "split": task.get("split"),
            "model": row.get("name"), "epochs": row.get("epochs"), "input_px": row.get("input_px"),
            "aggregation": row.get("aggregation"), "metrics": row.get("metrics", {}), "note": row.get("note"),
            "source": row.get("source"),
            "limitation": "Different cohort and prepared 128-voxel grid from the ASOCA native-grid evaluation; the two scores are not directly comparable."}


def install(app, require_roles, roles):
    @router.get("/registry")
    def model_registry(user=Depends(require_roles(*roles))):
        return registry()

    @router.get("/comparison")
    def model_comparison(user=Depends(require_roles(*roles))):
        return comparison()
    @router.get("/evidence-status")
    def current_evidence(user=Depends(require_roles("admin", "doctor", "clinician", "researcher", "ml_engineer", "technician", "viewer"))):
        return evidence_status()
    app.include_router(router)
