"""Reviewer caliper measurements on a prepared 2D image (independent references for severity agreement).

The browser sends only caliper endpoints in the prepared 512 grid. Widths, units and
narrowing are computed here from the image's recorded resize geometry, so the client
cannot submit a number that does not follow from the points. Records are append-only
JSON files and are never mixed into model predictions.
"""
import csv
import hashlib
import io
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

SCHEMA = "corovision.reviewer-reference.v1"
PREPARED = 512

Point = tuple[float, float]


class ReferenceMeasurementIn(BaseModel):
    model_config = {"extra": "forbid", "allow_inf_nan": False}
    image_id: str
    analysis_event_id: str | None = None
    lesion_id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    minimum: tuple[Point, Point]
    reference: tuple[Point, Point]
    ai_overlay_visible: bool
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("minimum", "reference")
    @classmethod
    def inside_prepared_grid(cls, value):
        if any(not 0 <= c <= PREPARED for point in value for c in point):
            raise ValueError("Caliper points must lie inside the 512 × 512 prepared image")
        return value


def _geometry(image):
    config = json.loads(image.preprocessing_config_json or "{}")
    geometry = config.get("resize_geometry")
    if not geometry:
        raise HTTPException(422, "This image has no recorded resize geometry, so calipers cannot be mapped to source pixels")
    return geometry


def _source_length(points, geometry):
    (x1, y1), (x2, y2) = points
    left, top = geometry["padding_left_top_xy"]
    width, height = geometry["content_size_xy"]
    if not all(left <= x <= left + width and top <= y <= top + height for x, y in points):
        raise HTTPException(422, "Caliper points must lie on the image, not the padding")
    sx, sy = geometry["source_pixels_per_content_pixel_xy"]
    return math.hypot((x2 - x1) * sx, (y2 - y1) * sy), ((x2 - x1) * sx, (y2 - y1) * sy)


def _spacing(image):
    """Pixel spacing in mm as (row, column), only when the source recorded it."""
    if not image.spacing_mm:
        return None
    try:
        row, column = (float(part) for part in str(image.spacing_mm).split(","))
    except ValueError:
        return None
    return (row, column) if row > 0 and column > 0 else None


def compute(image, body: ReferenceMeasurementIn):
    geometry = _geometry(image)
    minimum, minimum_delta = _source_length(body.minimum, geometry)
    reference, reference_delta = _source_length(body.reference, geometry)
    if reference <= 0 or minimum <= 0:
        raise HTTPException(422, "Both calipers need two distinct points")
    if minimum > reference:
        raise HTTPException(422, "The minimum lumen diameter cannot exceed the reference diameter")
    spacing = _spacing(image)
    mm = None
    if spacing:
        row, column = spacing
        mm = dict(minimum=math.hypot(minimum_delta[0] * column, minimum_delta[1] * row),
                  reference=math.hypot(reference_delta[0] * column, reference_delta[1] * row))
    return dict(minimum_diameter=round(minimum, 3), reference_diameter=round(reference, 3), diameter_unit="source_px",
                narrowing_percent=round((reference - minimum) / reference * 100, 2),
                minimum_diameter_mm=round(mm["minimum"], 3) if mm else None,
                reference_diameter_mm=round(mm["reference"], 3) if mm else None,
                calibration=("source pixel spacing " + str(image.spacing_mm)) if mm else None)


CSV_FIELDS = ("reference_schema_version", "case_id", "study_id", "frame_id", "lesion_id", "source_dataset",
              "source_image_sha256", "modality", "anatomy", "lesion_location_original_xy", "reference_location_original_xy",
              "minimum_diameter", "reference_diameter", "diameter_unit", "reference_method", "reference_method_version",
              "reviewer_or_method_id", "measured_at", "quality_status", "independent_of_corovision",
              "reference_narrowing_percent", "ai_overlay_visible", "notes")


def install(app, *, get_db, current_user, accessible_case, storage: Path, audit, Image, Case, reviewer_roles):
    router = APIRouter(prefix="/api/cases/{case_id}/reference-measurements", tags=["Reviewer reference measurements"])
    folder = storage / "reference_measurements"

    def rows(case_id):
        path = folder / case_id
        if not path.is_dir():
            return []
        return sorted((json.loads(item.read_text()) for item in path.glob("*.json")), key=lambda row: row["measured_at"])

    @router.post("", status_code=201)
    def create(case_id: str, body: ReferenceMeasurementIn, user=Depends(current_user), db=Depends(get_db)):
        if user.role not in reviewer_roles:
            raise HTTPException(403, "Only doctors, clinicians and administrators record reference measurements")
        case = accessible_case(case_id, user, db, required_action="review")
        image = db.get(Image, body.image_id)
        if image is None or image.case_id != case.id:
            raise HTTPException(404, "Image not found in this case")
        values = compute(image, body)
        geometry = _geometry(image)
        sx, sy = geometry["source_pixels_per_content_pixel_xy"]
        left, top = geometry["padding_left_top_xy"]
        ox, oy = geometry.get("source_roi_origin_xy", [0, 0])
        to_source = lambda p: [round(ox + (p[0] - left) * sx, 2), round(oy + (p[1] - top) * sy, 2)]
        row = dict(id=uuid4().hex, reference_schema_version=SCHEMA, case_id=case.id, study_id=case.case_code,
                   frame_id=image.id, image_id=image.id, analysis_event_id=body.analysis_event_id, lesion_id=body.lesion_id,
                   source_dataset=getattr(case, "source_dataset", None) or "unspecified",
                   source_image_sha256=image.source_sha256, modality="XCA", anatomy=case.anatomy,
                   minimum_caliper_prepared_xy=[list(p) for p in body.minimum], reference_caliper_prepared_xy=[list(p) for p in body.reference],
                   lesion_location_original_xy=[to_source(p) for p in body.minimum],
                   reference_location_original_xy=[to_source(p) for p in body.reference],
                   **values, reference_method="reviewer_manual_calipers", reference_method_version="1.0",
                   reviewer_id=user.id, reviewer_or_method_id=user.id, ai_overlay_visible=body.ai_overlay_visible,
                   independent_of_corovision=not body.ai_overlay_visible, quality_status="eligible", notes=body.notes,
                   measured_at=datetime.now(timezone.utc).isoformat(), clinical_validated=False)
        if not row["source_image_sha256"]:
            raise HTTPException(422, "Image source hash is not recorded")
        target = folder / case.id
        target.mkdir(parents=True, exist_ok=True)
        with (target / f"{row['id']}.json").open("x") as stream:
            json.dump(row, stream)
        audit(db, user.id, f"reference_measurement_saved:{row['id']}", case.id)
        db.commit()
        return row

    @router.get("")
    def listing(case_id: str, user=Depends(current_user), db=Depends(get_db)):
        accessible_case(case_id, user, db)
        return rows(case_id)

    @router.get("/export.csv")
    def export(case_id: str, user=Depends(current_user), db=Depends(get_db)):
        accessible_case(case_id, user, db)
        stream = io.StringIO()
        writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in rows(case_id):
            writer.writerow({**row, "reference_narrowing_percent": row["narrowing_percent"],
                             "lesion_location_original_xy": json.dumps(row["lesion_location_original_xy"]),
                             "reference_location_original_xy": json.dumps(row["reference_location_original_xy"])})
        digest = hashlib.sha256(stream.getvalue().encode()).hexdigest()[:12]
        return Response(stream.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="reference-measurements-{digest}.csv"'})

    app.include_router(router)
