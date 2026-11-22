"""Read-only imported validation reports; never executes evaluation or training."""
import hashlib
import json
from functools import lru_cache
from pathlib import Path

from .trained_release import RELEASE

RELEASES = Path(__file__).resolve().parents[2] / "ml" / "releases"
EVIDENCE_FILE = RELEASES / "evaluation_evidence_20261122.json"
HISTORY_FILE = RELEASES / "training_history_20261023.json"


@lru_cache(maxsize=1)
def training_histories():
    """Offline training histories of the installed checkpoints (task -> record)."""
    if not HISTORY_FILE.is_file():
        return {}
    data = json.loads(HISTORY_FILE.read_text())
    return {row["task"]: row for row in data.get("models", []) if row.get("checkpoint_sha256")}


@lru_cache(maxsize=1)
def _evidence():
    """Versioned metric evidence recorded from frozen-model evaluations (task -> record)."""
    if not EVIDENCE_FILE.is_file():
        return {}, None
    raw = EVIDENCE_FILE.read_bytes()
    data = json.loads(raw)
    return {row["task"]: row for row in data.get("records", [])}, {
        "file": f"ml/releases/{EVIDENCE_FILE.name}", "sha256": hashlib.sha256(raw).hexdigest(),
        "scope": data.get("scope")}


def evaluation_runs():
    records = []
    evidence, evidence_source = _evidence()
    for model in RELEASE["models"]:
        extra = evidence.get(model["task"], {})
        history = training_histories().get(model["task"], {})
        if history and history["checkpoint_sha256"] != model["sha256"]:
            history = {}  # never attach a history recorded for a different checkpoint
        artery = model["task"] == "syntax"
        aggregation = "mean image" if artery else "pooled union"
        records.append({
            "id": f'{RELEASE["version"]}:{model["task"]}',
            "record_type": "imported_release_validation_report",
            "model": {"architecture": model["architecture"], "version": RELEASE["version"],
                      "checkpoint_sha256": model["sha256"], "checkpoint_reference": model["filename"]},
            "task": "binary_artery_segmentation" if artery else "stenosis_masks",
            "dataset": {"name": "ARCADE", "version": None, "split": "validation",
                        "patient_independence_verified": None},
            "dimension": "2D",
            "sample_counts": {"images": model["validation_images"], "patients": None,
                              "studies": None, "excluded": None},
            "metrics": [
                {"name": "Dice", "value": model["validation_dice"], "unit": "ratio",
                 "aggregation": aggregation, "definition": "2 × intersection / (prediction size + reference size)"},
                {"name": "IoU", "value": model["validation_iou"], "unit": "ratio",
                 "aggregation": aggregation, "definition": "Intersection / union of prediction and reference masks"},
            ],
            "protocol": {"id": None, "description": model["validation_status"],
                         "independent_final_test": False},
            "evaluated_at": None, "runtime_seconds": None, "hardware": None,
            "approval_status": None, "reviewer_status": None,
            "source": "ml/releases/corovision_20261023.json",
            "training_history": [], "prediction_artifacts": [], "sample_evaluations": [],
            "limitations": RELEASE["limitations"],
        })
        record = records[-1]
        record["metrics"] += [dict(metric) for metric in extra.get("metrics", [])]
        record["confusion"] = extra.get("confusion")
        record["operating_point"] = extra.get("operating_point")
        record["training_history"] = list(history.get("history", []))
        record["training_config"] = history.get("config")
        record["dataset"].update(history.get("dataset", {}))
        record["dataset"]["name"] = "ARCADE"
        record["evidence_source"] = ({**evidence_source, "report": extra.get("source"),
                                      "report_sha256": extra.get("source_sha256")} if extra else None)
    return records


EXTERNAL_FILE = RELEASES / "external_validation_cadica_20261122.json"


def external_runs():
    """External-dataset checks of the frozen release, kept separate from ARCADE validation."""
    if not EXTERNAL_FILE.is_file():
        return []
    raw = EXTERNAL_FILE.read_bytes()
    data = json.loads(raw)
    stenosis = next(m for m in RELEASE["models"] if m["task"] == "stenosis")
    return [{
        "id": f'{RELEASE["version"]}:stenosis:external:{data["dataset"]["name"]}',
        "record_type": "external_validation_report",
        "model": {"architecture": stenosis["architecture"], "version": RELEASE["version"],
                  "checkpoint_sha256": stenosis["sha256"], "checkpoint_reference": stenosis["filename"]},
        "task": "stenosis_masks", "dataset": data["dataset"], "dimension": "2D",
        "sample_counts": data["sample_counts"], "metrics": data["metrics"],
        "protocol": {"id": data.get("protocol_id"), "description": data["protocol"], "independent_final_test": False},
        "evaluated_at": data.get("evaluated_at"), "runtime_seconds": data.get("runtime_seconds"),
        "hardware": data.get("hardware"), "approval_status": None, "reviewer_status": None,
        "source": f"ml/releases/{EXTERNAL_FILE.name}", "training_history": [], "training_config": None,
        "prediction_artifacts": [], "sample_evaluations": [], "limitations": data["limitations"],
        "confusion": data["confusion"], "operating_point": data.get("operating_point"),
        "severity_agreement": data["severity_agreement"],
        "evidence_source": {"file": f"ml/releases/{EXTERNAL_FILE.name}", "sha256": hashlib.sha256(raw).hexdigest(),
                            "report": data.get("report"), "report_sha256": data.get("report_sha256")},
    }]


def catalog():
    release = evaluation_runs()
    runs = release + external_runs()
    return {"runs": runs, "summary": {
        "evaluated_models": len(release), "imported_evaluation_records": len(runs),
        "approved_models": None, "experimental_models": None, "running_experiments": None,
        "pending_review": None, "failed_experiments": None, "latest_successful_evaluation": None,
    }, "capabilities": {
        "epoch_history": any(run["training_history"] for run in runs), "evaluation_predictions": False,
        "confusion_counts": any(run.get("confusion") for run in runs), "dataset_audits": False,
        "approval_workflow": False, "live_training": False,
    }, "research_only": True}
