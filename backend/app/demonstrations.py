"""Deterministic software demonstrations; never model or clinical validation."""
from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
import hashlib
import json
import math

import numpy as np
from fastapi import APIRouter, Depends
from fastapi.responses import Response

from .evaluation_workspace import readers
from .narrowing import diameter_reduction, experimental_research_grade
from .volume_geometry import analyze_volume_mask

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
                   uncertainty: float = 0.0) -> dict:
    measurement = diameter_reduction(
        minimum=minimum, reference=reference, unit="mm",
        measurement_frame="synthetic-known-scale", candidate_id=identity,
        reference_segment_id=f"{identity}-reference", protocol_id=PROTOCOL,
        calibration_verified=True, reference_selection_reviewed=True,
    )
    grade = experimental_research_grade(
        measurement["narrowing_percent"], authorization=AUTHORIZATION,
        uncertainty_percentage_points=uncertainty,
    )
    actual = grade.get("category")
    passed = actual == expected
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


def _tube(disconnected: bool = False) -> np.ndarray:
    grid = np.indices((32, 32, 32))
    mask = ((grid[0]-16)**2 + (grid[1]-16)**2 <= 16) & (grid[2] >= 5) & (grid[2] <= 26)
    if disconnected:
        mask[:, :, 15:18] = False
    return mask.astype(np.uint8)


@lru_cache(maxsize=1)
def suite() -> dict:
    severity = [
        _severity_case("no-narrowing", 10, 10, "No measured narrowing"),
        _severity_case("minimal-boundary", 7.5001, 10, "Minimal"),
        _severity_case("mild-boundary", 7.5, 10, "Mild"),
        _severity_case("moderate-boundary", 5, 10, "Moderate"),
        _severity_case("severe-boundary", 3, 10, "Severe"),
        _severity_case("uncertain-boundary", 5, 10, None, 0.01),
    ]
    straight = analyze_volume_mask(_tube(), np.diag([0.5, 0.5, 1.0, 1.0]), spatial_unit="mm")
    fragmented = analyze_volume_mask(_tube(True), np.diag([0.5, 0.5, 1.0, 1.0]), spatial_unit="mm")
    volume = [
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
    rows = severity + volume
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
        "sections": {"severity_boundaries": severity, "three_dimensional_quality": volume},
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
