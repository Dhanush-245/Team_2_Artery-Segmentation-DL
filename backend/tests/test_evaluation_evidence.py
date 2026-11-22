"""The evaluation catalog serves the full recorded metric set (brief modules 11 and 12)."""
from app.evaluation_catalog import catalog


def _metrics(run):
    return {m["name"]: m for m in run["metrics"]}


def test_segmentation_record_has_full_metric_set_and_confusion():
    runs = {r["task"]: r for r in catalog()["runs"] if r["record_type"] == "imported_release_validation_report"}
    seg = runs["binary_artery_segmentation"]
    names = _metrics(seg)
    for name in ("Dice", "IoU", "Pixel accuracy", "Precision", "Recall", "Sensitivity", "Specificity",
                 "Hausdorff distance", "HD95", "ASSD"):
        assert name in names, name
        assert isinstance(names[name]["value"], float)
    assert names["HD95"]["unit"].startswith("px")
    assert set(seg["confusion"]) >= {"tp", "fp", "fn", "tn", "level"}
    assert seg["evidence_source"]["sha256"] and len(seg["evidence_source"]["sha256"]) == 64


def test_detection_record_has_instance_metrics_at_frozen_threshold():
    runs = {r["task"]: r for r in catalog()["runs"] if r["record_type"] == "imported_release_validation_report"}
    det = runs["stenosis_masks"]
    names = _metrics(det)
    for name in ("Precision", "Recall", "F1", "AUC-ROC", "False positives per image"):
        assert name in names, name
    assert det["confusion"]["tp"] + det["confusion"]["fn"] > 0
    assert det["operating_point"]["score_threshold"] == 0.25
    assert det["protocol"]["independent_final_test"] is False


def test_capabilities_reflect_served_evidence():
    data = catalog()
    assert data["capabilities"]["evaluation_predictions"] is False
    assert data["capabilities"]["confusion_counts"] is True
