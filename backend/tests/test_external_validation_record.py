"""External (CADICA) validation is served as its own record, never merged into ARCADE metrics."""
from app.evaluation_catalog import catalog


def test_external_record_is_separate_and_labelled():
    runs = catalog()["runs"]
    external = [r for r in runs if r["record_type"] == "external_validation_report"]
    assert len(external) == 1
    run = external[0]
    assert run["dataset"]["name"] == "CADICA" and run["dataset"]["split"] == "external"
    assert run["protocol"]["independent_final_test"] is False
    names = {m["name"] for m in run["metrics"]}
    assert {"Lesion recall", "Lesion precision", "Lesion F1", "Frame sensitivity", "Frame specificity", "Frame AUC-ROC"} <= names
    assert run["confusion"]["tp"] >= 0 and run["severity_agreement"]["graded"] >= 0
    assert run["evidence_source"]["report_sha256"]
    # ARCADE records keep Dice and IoU first and are untouched by the external record.
    arcade = [r for r in runs if r["record_type"] == "imported_release_validation_report"]
    assert len(arcade) == 2 and all(r["metrics"][0]["name"] == "Dice" for r in arcade)
