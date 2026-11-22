"""Reviewer edits to saved 3D vessel geometry (one append-only record per edit).

A reviewer accepts, rejects or flags one extracted centreline path, may name the artery, and may
place a minimum and a reference marker along the path (arc length in mm, chosen on the CPR view).
The browser sends only those choices. Diameters and narrowing are computed here from the saved
mask, so a client cannot submit a number that does not follow from the geometry. Model outputs
are never changed; the latest record per path is the current reviewer state.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

import nibabel as nib
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

SCHEMA = 'corovision.volume-geometry-review.v1'
ARTERIES = ('LM', 'LAD', 'LCx', 'RCA', 'diagonal', 'obtuse_marginal', 'ramus', 'PDA', 'PLV', 'other_coronary', 'not_coronary')
MIN_MARKER_SEPARATION_MM = 1.0
SECTION_CROP_MM = 15.0
TANGENT_HALF_SPAN_MM = 1.0


class GeometryReviewIn(BaseModel):
    model_config = {'extra': 'forbid', 'allow_inf_nan': False}
    path_id: str = Field(pattern=r'^P\d{1,5}$')
    mask_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    decision: Literal['accept', 'reject', 'uncertain']
    artery: Literal[ARTERIES] | None = None
    minimum_position_mm: float | None = Field(default=None, ge=0)
    reference_position_mm: float | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def markers_together(self):
        marked = (self.minimum_position_mm is None, self.reference_position_mm is None)
        if marked[0] != marked[1]:
            raise ValueError('Place both the minimum and the reference marker, or neither')
        if not marked[0] and self.decision == 'reject':
            raise ValueError('A rejected path cannot carry lumen markers')
        if not marked[0] and abs(self.minimum_position_mm - self.reference_position_mm) < MIN_MARKER_SEPARATION_MM:
            raise ValueError('The minimum and reference markers must be at least 1 mm apart')
        return self


def _arc(points):
    points = np.asarray(points, dtype=float)
    return points, np.r_[0, np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]


def _at(points, cumulative, position):
    return np.array([np.interp(position, cumulative, points[:, axis]) for axis in range(3)])


def _section(mask_image, centre, tangent):
    """Perpendicular cross-section of the saved mask at one world point (cropped load)."""
    from .volume_measurements import cross_section
    inverse = np.linalg.inv(mask_image.affine)
    spacing = np.linalg.norm(mask_image.affine[:3, :3], axis=0)
    middle = nib.affines.apply_affine(inverse, centre)
    half = np.ceil(SECTION_CROP_MM / spacing).astype(int)
    low = np.maximum(np.floor(middle).astype(int) - half, 0)
    high = np.minimum(np.ceil(middle).astype(int) + half + 1, np.array(mask_image.shape[:3]))
    if np.any(high <= low):
        return dict(status='outside_volume')
    box = tuple(slice(int(a), int(b)) for a, b in zip(low, high))
    affine = mask_image.affine.copy()
    affine[:3, 3] = nib.affines.apply_affine(mask_image.affine, low)
    result = cross_section(np.asarray(mask_image.dataobj[box]) > 0, affine, centre, tangent)
    return {key: result[key] for key in ('status', 'area_mm2', 'equivalent_diameter_mm') if key in result}


def measure_markers(mask_path, path_record, minimum_mm, reference_mm):
    """Server-side diameters at the reviewer's two markers on one saved path."""
    points, cumulative = _arc(path_record['points_ras_mm'])
    length = float(cumulative[-1])
    if max(minimum_mm, reference_mm) > length + 1e-6:
        raise ValueError(f'Markers must lie on the path (0–{length:.1f} mm)')
    widths = np.asarray(path_record['mask_width_mm'], dtype=float)
    mask_image = nib.load(str(mask_path))
    sites = {}
    for name, position in (('minimum', minimum_mm), ('reference', reference_mm)):
        centre = _at(points, cumulative, position)
        tangent = (_at(points, cumulative, min(position + TANGENT_HALF_SPAN_MM, length))
                   - _at(points, cumulative, max(position - TANGENT_HALF_SPAN_MM, 0)))
        section = _section(mask_image, centre, tangent)
        sites[name] = dict(position_mm=round(position, 2), location_ras_mm=[round(v, 2) for v in centre.tolist()],
                           mask_width_mm=round(float(np.interp(position, cumulative, widths)), 3),
                           section_status=section['status'],
                           section_diameter_mm=round(section['equivalent_diameter_mm'], 3) if 'equivalent_diameter_mm' in section else None,
                           section_area_mm2=round(section['area_mm2'], 3) if 'area_mm2' in section else None)
    both_sections = all(site['section_diameter_mm'] for site in sites.values())
    key, method = (('section_diameter_mm', 'perpendicular_section_area_equivalent_diameter') if both_sections
                   else ('mask_width_mm', 'centreline_distance_transform_width'))
    minimum, reference = sites['minimum'][key], sites['reference'][key]
    if not reference or reference <= 0:
        raise ValueError('The reference marker is not inside the vessel mask')
    if minimum > reference:
        raise ValueError('The minimum diameter is larger than the reference diameter; swap or move the markers')
    return dict(minimum=sites['minimum'], reference=sites['reference'], diameter_method=method,
                minimum_diameter_mm=minimum, reference_diameter_mm=reference,
                narrowing_percent=round((reference - minimum) / reference * 100, 2))


def records(storage: Path, run_id: str):
    folder = storage / 'volumes' / run_id / 'review'
    if not folder.is_dir():
        return []
    return sorted((json.loads(item.read_text()) for item in folder.glob('*.json')), key=lambda row: row['reviewed_at'])


def current(rows):
    """Latest record per path, in path order."""
    latest = {}
    for row in rows:
        latest[row['path_id']] = row
    return [latest[key] for key in sorted(latest, key=lambda value: int(value[1:]))]


def for_report(storage: Path, run_id: str):
    rows = records(storage, run_id)
    if not rows:
        return None
    return dict(schema_version=SCHEMA, edits_recorded=len(rows), current=current(rows),
                note='Reviewer decisions on predicted-mask geometry; model outputs are unchanged. Not clinical validation.')


def install(app, *, get_db, current_user, accessible_case, storage: Path, audit, VolumeAnalysis, reviewer_roles):
    router = APIRouter(prefix='/api/cases/{case_id}/volumes/analyses/{run_id}/geometry-review',
                       tags=['Reviewer 3D geometry edits'])

    def completed_run(case_id, run_id, db):
        row = db.get(VolumeAnalysis, run_id)
        if row is None or row.case_id != case_id or row.status != 'completed':
            raise HTTPException(404, 'Completed volume analysis unavailable')
        mask = storage / 'volumes' / row.id / 'outputs' / 'mask_source.nii.gz'
        if not mask.is_file():
            raise HTTPException(404, 'Saved vessel mask unavailable')
        return row, mask

    @router.get('')
    def listing(case_id: str, run_id: str, user=Depends(current_user), db=Depends(get_db)):
        accessible_case(case_id, user, db)
        completed_run(case_id, run_id, db)
        rows = records(storage, run_id)
        return dict(schema_version=SCHEMA, history=rows, current=current(rows),
                    can_review=user.role in reviewer_roles, arteries=list(ARTERIES))

    @router.post('', status_code=201)
    def create(case_id: str, run_id: str, body: GeometryReviewIn, user=Depends(current_user), db=Depends(get_db)):
        if user.role not in reviewer_roles:
            raise HTTPException(403, 'Only doctors, clinicians and administrators record geometry review edits')
        case = accessible_case(case_id, user, db, required_action='review')
        row, mask = completed_run(case_id, run_id, db)
        from .volume_measurements import saved_measurement
        geometry = saved_measurement(mask)
        if geometry.get('mask_sha256') != body.mask_sha256:
            raise HTTPException(409, 'The saved geometry changed since it was loaded; reload before editing')
        path_record = next((item for item in geometry.get('paths') or [] if item['id'] == body.path_id), None)
        if path_record is None:
            raise HTTPException(404, 'Path not found in the saved geometry')
        measurement = None
        if body.minimum_position_mm is not None:
            try:
                measurement = measure_markers(mask, path_record, body.minimum_position_mm, body.reference_position_mm)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        record = dict(id=uuid4().hex, schema_version=SCHEMA, case_id=case.id, analysis_run_id=row.id,
                      mask_sha256=body.mask_sha256, geometry_method=geometry.get('method'), path_id=body.path_id,
                      path_length_mm=round(float(path_record['length_mm']), 2), decision=body.decision,
                      artery=body.artery, measurement=measurement, notes=body.notes, reviewer_id=user.id,
                      reviewer_role=user.role, ai_mask_visible=True, independent_of_corovision=False,
                      reviewed_at=datetime.now(timezone.utc).isoformat(), clinical_validated=False)
        folder = storage / 'volumes' / row.id / 'review'
        folder.mkdir(parents=True, exist_ok=True)
        with (folder / f"{record['id']}.json").open('x') as stream:
            json.dump(record, stream)
        audit(db, user.id, f"volume_geometry_review_saved:{row.id}:{body.path_id}:{body.decision}", case.id)
        db.commit()
        return record

    app.include_router(router)
