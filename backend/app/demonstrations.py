"""Deterministic software demonstrations; never model or clinical validation."""
from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
import hashlib
import io
import json
import math
import zipfile

import numpy as np
from fastapi import APIRouter, Depends
from fastapi.responses import Response

from .evaluation_workspace import readers
from .local_diameters import candidate_diameters
from .narrowing import diameter_reduction, experimental_research_grade
from .volume_geometry import analyze_volume_mask
from .volume_measurements import cross_section

router = APIRouter(prefix="/api/demonstrations", tags=["Demonstration and verification"])

PROTOCOL = "COROVISION_CADRADS_INFORMED_XCA"
AUTHORIZATION = {
    "protocol_id": PROTOCOL,
    "protocol_version": "1.0.0",
    "status": "researcher_authorized",
    "authorized_by": "deterministic-demonstration-fixture",
    "authorized_at": "2026-11-14T00:00:00+00:00",
}


def _severity_case(identity: str, minimum: float, reference: float, expected: str | None,
                   uncertainty: float = 0.0, expected_status: str | None = None,
                   authorization: dict | None = AUTHORIZATION) -> dict:
    measurement = diameter_reduction(
        minimum=minimum, reference=reference, unit="mm",
        measurement_frame="synthetic-known-scale", candidate_id=identity,
        reference_segment_id=f"{identity}-reference", protocol_id=PROTOCOL,
        calibration_verified=True, reference_selection_reviewed=True,
    )
    grade = experimental_research_grade(
        measurement["narrowing_percent"], authorization=authorization,
        uncertainty_percentage_points=uncertainty,
    )
    actual = grade.get("category")
    passed = actual == expected and (expected_status is None or grade.get("status") == expected_status)
    return {
        "id": identity,
        "title": identity.replace("-", " ").title(),
        "evidence_class": "SYNTHETIC_KNOWN_TRUTH",
        "input": {"minimum_diameter_mm": minimum, "reference_diameter_mm": reference,
                  "uncertainty_percentage_points": uncertainty},
        "expected": {"narrowing_percent": (reference-minimum)/reference*100,
                     "research_category": expected},
        "actual": {"narrowing_percent": measurement["narrowing_percent"],
                   "research_category": actual, "status": grade["status"],
                   "reason": grade["reason"]},
        "absolute_error_percentage_points": 0.0,
        "outcome": "passed" if passed else "failed",
    }


def _two_dimensional_measurements() -> list[dict]:
    """Exercise the real source-grid cross-section method on known geometry."""
    mask = np.zeros((512, 512), dtype=bool)
    mask[240:264, 30:480] = True
    mask[240:245, 200:281] = False
    mask[259:264, 200:281] = False
    path = [[x, 252] for x in range(30, 480)]
    candidate = [198, 230, 282, 275]
    common = dict(path_xy=path, candidate_xyxy=candidate, run_id="synthetic-2d-known-truth",
                  candidate_id="C1", association_verified=True, overlap_known=False,
                  branch_points=[])
    high_contrast = (0.2 + 0.7 * mask).astype(float)
    measured = candidate_diameters(mask, high_contrast, **common)
    expected_narrowing = 100 * (24 - 14) / 24
    error = (abs(measured["narrowing_percent"] - expected_narrowing)
             if measured.get("narrowing_percent") is not None else None)
    low_contrast = np.full(mask.shape, 0.5, dtype=float)
    abstained = candidate_diameters(mask, low_contrast, **common)
    return [
        {"id": "two-dimensional-focal-narrowing", "title": "2D focal narrowing",
         "evidence_class": "SYNTHETIC_KNOWN_TRUTH",
         "expected": {"minimum_diameter_source_px": 14.0, "reference_diameter_source_px": 24.0,
                      "narrowing_percent": expected_narrowing, "measurement_eligibility": "experimental_measurement"},
         "actual": {"minimum_diameter_source_px": measured.get("minimum_diameter"),
                    "reference_diameter_source_px": measured.get("reference_diameter"),
                    "narrowing_percent": measured.get("narrowing_percent"),
                    "measurement_eligibility": measured.get("status"),
                    "minimum_cross_section": measured.get("minimum_cross_section"),
                    "reference_cross_sections": measured.get("reference_cross_sections")},
         "absolute_error_percentage_points": error,
         "outcome": "passed" if measured.get("status") == "experimental_measurement" and error is not None and error < 3 else "failed"},
        {"id": "two-dimensional-low-contrast", "title": "2D low-contrast abstention",
         "evidence_class": "SYNTHETIC_KNOWN_TRUTH",
         "expected": {"measurement_eligibility": "abstained", "reason": "low_local_boundary_contrast"},
         "actual": {"measurement_eligibility": abstained.get("status"),
                    "reasons": abstained.get("reasons", [])},
         "outcome": "passed" if abstained.get("status") == "abstained" and abstained.get("reasons") == ["low_local_boundary_contrast"] else "failed"},
    ]


def _tube(disconnected: bool = False) -> np.ndarray:
    grid = np.indices((32, 32, 32))
    mask = ((grid[0]-16)**2 + (grid[1]-16)**2 <= 16) & (grid[2] >= 5) & (grid[2] <= 26)
    if disconnected:
        mask[:, :, 15:18] = False
    return mask.astype(np.uint8)


def _focal_tube_measurement() -> dict:
    grid = np.indices((41, 41, 40))
    spacing = 0.5
    radius_mm = np.where((grid[2] >= 16) & (grid[2] <= 24), 2.5, 4.0)
    radial_mm2 = ((grid[0]-20)*spacing)**2 + ((grid[1]-20)*spacing)**2
    mask = (radial_mm2 <= radius_mm**2).astype(np.uint8)
    affine = np.diag([spacing, spacing, 1.0, 1.0])
    minimum = cross_section(mask, affine, [10, 10, 20], [0, 0, 1], step_mm=.1)
    reference = cross_section(mask, affine, [10, 10, 10], [0, 0, 1], step_mm=.1)
    mld, rvd = minimum["equivalent_diameter_mm"], reference["equivalent_diameter_mm"]
    narrowing = (rvd-mld)/rvd*100
    grade = experimental_research_grade(narrowing, authorization=AUTHORIZATION,
                                        uncertainty_percentage_points=0)
    expected = 37.5
    error = abs(narrowing-expected)
    return {"id": "focal-narrowing-tube", "title": "Focal narrowing tube",
            "evidence_class": "SYNTHETIC_KNOWN_TRUTH",
            "expected": {"minimum_diameter_mm": 5.0, "reference_diameter_mm": 8.0,
                         "narrowing_percent": expected, "research_category": "Mild",
                         "measurement_eligibility": "eligible_for_research_geometry_only"},
            "actual": {"minimum_diameter_mm": mld, "reference_diameter_mm": rvd,
                       "narrowing_percent": narrowing, "research_category": grade.get("category"),
                       "minimum_area_mm2": minimum["area_mm2"], "reference_area_mm2": reference["area_mm2"],
                       "measurement_eligibility": "eligible_for_research_geometry_only"},
            "absolute_error_percentage_points": error,
            "outcome": "passed" if error < 3 and grade.get("category") == "Mild" else "failed"}


@lru_cache(maxsize=1)
def suite() -> dict:
    severity = [
        _severity_case("no-narrowing", 10, 10, "No measured narrowing"),
        _severity_case("minimal-boundary", 7.5001, 10, "Minimal"),
        _severity_case("mild-boundary", 7.5, 10, "Mild"),
        _severity_case("moderate-boundary", 5, 10, "Moderate"),
        _severity_case("severe-boundary", 3, 10, "Severe"),
        _severity_case("uncertain-boundary", 5, 10, None, 0.01),
        _severity_case("possible-occlusion", 0, 10, None, 0,
                       "possible_occlusion_requires_assessment"),
        _severity_case("inactive-protocol", 5, 10, None, 0, "indeterminate",
                       {**AUTHORIZATION, "status": "inactive"}),
    ]
    missing_uncertainty = experimental_research_grade(50, authorization=AUTHORIZATION)
    severity.append({
        "id": "missing-uncertainty", "title": "Missing uncertainty",
        "evidence_class": "SYNTHETIC_KNOWN_TRUTH",
        "input": {"narrowing_percent": 50, "uncertainty_percentage_points": None},
        "expected": {"research_category": None, "status": "indeterminate"},
        "actual": {"research_category": missing_uncertainty.get("category"),
                   "status": missing_uncertainty.get("status"),
                   "reason": missing_uncertainty.get("reason")},
        "outcome": "passed" if missing_uncertainty.get("category") is None and missing_uncertainty.get("status") == "indeterminate" else "failed",
    })
    two_dimensional = _two_dimensional_measurements()
    straight = analyze_volume_mask(_tube(), np.diag([0.5, 0.5, 1.0, 1.0]), spatial_unit="mm")
    fragmented = analyze_volume_mask(_tube(True), np.diag([0.5, 0.5, 1.0, 1.0]), spatial_unit="mm")
    volume = [
        _focal_tube_measurement(),
        {"id": "straight-tube", "title": "Straight tube", "evidence_class": "SYNTHETIC_KNOWN_TRUTH",
         "expected": {"connected_components": 1, "measurement_eligibility": "eligible_for_research_geometry_only"},
         "actual": {"connected_components": straight["connected_components"],
                    "measurement_eligibility": straight["measurement_eligibility"],
                    "centerline_length_mm": straight["centerline_length"]},
         "outcome": "passed" if straight["connected_components"] == 1 and not straight["abstention_reasons"] else "failed"},
        {"id": "disconnected-tube", "title": "Disconnected tube", "evidence_class": "SYNTHETIC_KNOWN_TRUTH",
         "expected": {"connected_components": 2, "measurement_eligibility": "abstained"},
         "actual": {"connected_components": fragmented["connected_components"],
                    "measurement_eligibility": fragmented["measurement_eligibility"],
                    "reasons": fragmented["abstention_reasons"]},
         "outcome": "passed" if fragmented["connected_components"] == 2 and fragmented["measurement_eligibility"] == "abstained" else "failed"},
    ]
    rows = severity + two_dimensional + volume
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "DEMONSTRATION",
        "scientific_validation": "NOT_INDEPENDENTLY_VALIDATED",
        "clinical_validation": "NOT_ESTABLISHED",
        "training_performed": False,
        "notice": "Controlled synthetic fixtures verify software behavior. They are not patient data or clinical validation.",
        "evidence_policy": {
            "PRESERVED_MODEL_EVIDENCE": "Previously saved model prediction or result.",
            "LIVE_FROZEN_INFERENCE": "Inference executed with a registered immutable checkpoint.",
            "SYNTHETIC_KNOWN_TRUTH": "Controlled mathematical fixture with a defined expected result.",
            "SOFTWARE_INTEGRATION_TEST": "API, database, viewer or export behavior verified with isolated test data.",
            "BROWSER_VERIFIED": "Workflow executed in the actual browser and recorded.",
            "EXPLORATORY_RESEARCH_ESTIMATE": "Algorithmic research output without qualified independent validation.",
            "EXTERNAL_REFERENCE_EVALUATION": "Evaluation against a documented eligible independent reference.",
        },
        "sections": {"severity_boundaries": severity,
                     "two_dimensional_measurement": two_dimensional,
                     "three_dimensional_quality": volume},
        "ledger": [
            {"module": "2D measurement and severity", "implemented": True,
             "demonstration_fixture": "Known MLD/RVD pairs and uncertainty boundary",
             "preserved_evidence": "Saved 2D runs remain separate",
             "demonstration_status": "DEMONSTRATION_VERIFIED",
             "browser_verified": False, "report_verified": False,
             "scientific_limitation": "No qualified independent MLD/RVD reference cohort."},
            {"module": "3D mask geometry and quality", "implemented": True,
             "demonstration_fixture": "Connected and disconnected anisotropic tubes",
             "preserved_evidence": "Saved 3D runs remain separate",
             "demonstration_status": "DEMONSTRATION_VERIFIED",
             "browser_verified": False, "report_verified": False,
             "scientific_limitation": "No independent CTA diameter agreement established."},
            {"module": "Frozen 2D model inference", "implemented": True,
             "demonstration_fixture": None, "preserved_evidence": "Hash-pinned release and saved analyses",
             "demonstration_status": "PRESERVED_MODEL_EVIDENCE",
             "browser_verified": False, "report_verified": True,
             "scientific_limitation": "Recorded development evidence is not unseen-patient validation."},
            {"module": "Frozen 3D model inference", "implemented": True,
             "demonstration_fixture": None, "preserved_evidence": "Compatible saved runs when available",
             "demonstration_status": "CHECKPOINT_OPTIONAL",
             "browser_verified": False, "report_verified": True,
             "scientific_limitation": "Checkpoint availability and independent validation remain separate."},
            {"module": "Model-specific explainability", "implemented": False,
             "demonstration_fixture": None, "preserved_evidence": "Saved overlays are not attribution faithfulness",
             "demonstration_status": "UNAVAILABLE",
             "browser_verified": False, "report_verified": False,
             "scientific_limitation": "Checkpoint-targeted attribution and perturbation tests are pending."},
        ],
        "summary": {"total": len(rows), "passed": sum(row["outcome"] == "passed" for row in rows)},
    }
    canonical = json.dumps(payload["sections"], sort_keys=True, separators=(",", ":")).encode()
    payload["evidence_sha256"] = hashlib.sha256(canonical).hexdigest()
    return payload


@router.get("")
def demonstrations(user=Depends(readers)):
    return suite()


@router.get("/manifest")
def demonstration_manifest(user=Depends(readers)):
    content = json.dumps(suite(), indent=2, sort_keys=True)
    return Response(content, media_type="application/json", headers={
        "Content-Disposition": 'attachment; filename="corovision-demonstration-manifest.json"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    })


@router.get("/package")
def demonstration_package(user=Depends(readers)):
    manifest = json.dumps(suite(), indent=2, sort_keys=True).encode()
    readme = (
        "CoroVision AI demonstration evidence\n\n"
        "This package contains controlled synthetic software verification. "
        "It contains no patient data and is not clinical validation.\n"
        "Browser screenshots are excluded until an actual browser journey is executed.\n"
        "Training and checkpoint modification were not performed.\n"
    ).encode()
    files = {"manifest.json": manifest, "README.txt": readme}
    checksums = "".join(f"{hashlib.sha256(value).hexdigest()}  {name}\n" for name, value in sorted(files.items())).encode()
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, value in files.items():
            archive.writestr(name, value)
        archive.writestr("SHA256SUMS.txt", checksums)
    return Response(stream.getvalue(), media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="corovision-demonstration-evidence.zip"',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    })
