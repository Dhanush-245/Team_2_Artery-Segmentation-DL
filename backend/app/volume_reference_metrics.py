"""Source-bound reviewer reference evaluation of immutable 3D predictions."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import nibabel as nib
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from .segmentation_metrics import segmentation_metrics

MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_VOXELS = 96_000_000
MAX_DISTANCE_VOXELS = 16_000_000


def records(storage: Path, run_id: str):
    folder = storage / 'volumes' / run_id / 'reference_metrics'
    return sorted((json.loads(p.read_text()) for p in folder.glob('*.json')), key=lambda r: (r['created_at'], r['id']))


def matching_records(storage, row, mask=None):
    mask = mask or storage / 'volumes' / row.id / 'outputs' / 'mask_source.nii.gz'
    if not mask.is_file():
        return []
    digest = hashlib.sha256(mask.read_bytes()).hexdigest()
    return [r for r in records(storage, row.id)
            if r['prediction_sha256'] == digest and r['source_sha256'] == row.source_sha256
            and r['case_id'] == row.case_id and r['analysis_run_id'] == row.id]


def compare_masks(prediction_path, reference_path):
    pred_img, ref_img = nib.load(prediction_path), nib.load(reference_path)
    if len(ref_img.shape) != 3 or ref_img.shape != pred_img.shape:
        raise ValueError('Reference mask must have exactly the saved prediction source-grid shape')
    if np.prod(ref_img.shape) > MAX_VOXELS:
        raise ValueError('Reference mask exceeds the supported voxel limit')
    if not np.allclose(pred_img.affine, ref_img.affine, atol=1e-4, rtol=0):
        raise ValueError('Reference orientation, origin and spacing must match the saved prediction; automatic realignment is not performed')
    if ref_img.header.get_xyzt_units()[0] != 'mm' or pred_img.header.get_xyzt_units()[0] != 'mm':
        raise ValueError('Prediction and reference must declare millimetre units')
    spacing = tuple(float(v) for v in nib.affines.voxel_sizes(pred_img.affine))
    directions = pred_img.affine[:3, :3] / np.array(spacing)
    if not np.allclose(directions.T @ directions, np.eye(3), atol=1e-4):
        raise ValueError('Sheared grids are not supported for physical surface distances')
    ref_data = np.asarray(ref_img.dataobj)
    if not np.isfinite(ref_data).all() or not np.isin(ref_data, [0, 1]).all():
        raise ValueError('Reference must be a finite binary mask with labels 0 and 1')
    ref = ref_data.astype(bool)
    del ref_data
    pred = np.asarray(pred_img.dataobj) > 0
    union = pred | ref
    if union.any():
        box = []
        for axis in range(3):
            extent = np.flatnonzero(union.any(axis=tuple(a for a in range(3) if a != axis)))
            box.append(slice(max(0, int(extent[0])-1), min(pred.shape[axis], int(extent[-1])+2)))
        box = tuple(box)
        if np.prod([s.stop-s.start for s in box]) > MAX_DISTANCE_VOXELS:
            raise ValueError('Foreground extent exceeds the bounded surface-distance workspace; evaluate a reviewed cropped study separately')
        metrics = segmentation_metrics(pred[box], ref[box], spacing=spacing)
        # True-negative/accuracy statistics refer to the complete source grid.
        metrics['tn'] = int(pred.size - metrics['tp'] - metrics['fp'] - metrics['fn'])
        metrics['pixel_accuracy'] = (metrics['tp'] + metrics['tn']) / pred.size
        metrics['specificity'] = metrics['tn'] / (metrics['tn'] + metrics['fp']) if metrics['tn'] + metrics['fp'] else None
    else:
        metrics = segmentation_metrics(pred, ref, spacing=spacing)
    return metrics, list(spacing), list(pred.shape)


def install(app, *, get_db, current_user, accessible_case, storage, audit, VolumeAnalysis, reviewer_roles):
    router = APIRouter(prefix='/api/cases/{case_id}/volumes/analyses/{run_id}/reference-metrics')

    def context(case_id, run_id, user, db, action='read'):
        accessible_case(case_id, user, db, required_action=action)
        row = db.get(VolumeAnalysis, run_id)
        if not row or row.case_id != case_id or row.status != 'completed':
            raise HTTPException(404, 'Completed volume analysis unavailable')
        mask = storage / 'volumes' / row.id / 'outputs' / 'mask_source.nii.gz'
        if not mask.is_file():
            raise HTTPException(404, 'Saved source-grid prediction unavailable')
        return row, mask

    @router.get('')
    def listing(case_id: str, run_id: str, user=Depends(current_user), db=Depends(get_db)):
        row, mask = context(case_id, run_id, user, db)
        allowed = user.role in reviewer_roles
        if allowed:
            try:
                accessible_case(case_id, user, db, required_action='review')
            except HTTPException:
                allowed = False
        saved = matching_records(storage, row, mask)
        return dict(can_evaluate=allowed, source_sha256=row.source_sha256, records=saved)

    @router.post('', status_code=201)
    async def evaluate(case_id: str, run_id: str, file: UploadFile = File(...),
                       source_sha256: str = Form(...), provenance: str = Form(...),
                       same_study_confirmed: bool = Form(False), same_target_confirmed: bool = Form(False),
                       user=Depends(current_user), db=Depends(get_db)):
        if user.role not in reviewer_roles:
            raise HTTPException(403, 'Reference evaluation requires a clinical reviewer role')
        row, mask = context(case_id, run_id, user, db, 'review')
        if source_sha256 != row.source_sha256:
            raise HTTPException(409, 'Reference submission does not match this run source hash')
        if not same_study_confirmed or not same_target_confirmed or not 10 <= len(provenance.strip()) <= 2000:
            raise HTTPException(422, 'Confirm the exact study and segmentation target and provide reference provenance')
        suffix = '.nii.gz' if (file.filename or '').lower().endswith('.nii.gz') else '.nii'
        if not (file.filename or '').lower().endswith(('.nii', '.nii.gz')):
            raise HTTPException(422, 'Upload a source-aligned binary NIfTI reference mask')
        data = await file.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(413, 'Reference upload exceeds 32 MiB')
        with TemporaryDirectory() as temp:
            path = Path(temp) / ('reference' + suffix)
            path.write_bytes(data)
            try:
                metrics, spacing, shape = compare_masks(mask, path)
            except (ValueError, OSError, nib.filebasedimages.ImageFileError, EOFError) as exc:
                raise HTTPException(422, str(exc)) from exc
        identity = uuid4().hex
        record = dict(id=identity, case_id=case_id, analysis_run_id=run_id, source_sha256=row.source_sha256,
                      prediction_sha256=hashlib.sha256(mask.read_bytes()).hexdigest(),
                      reference_sha256=hashlib.sha256(data).hexdigest(), reference_file=identity+suffix,
                      model_id=(json.loads(row.result_json or '{}')).get('model_id'),
                      checkpoint_sha256=(json.loads(row.result_json or '{}')).get('checkpoint_sha256'),
                      provenance=provenance.strip(), reviewer_id=user.id, reviewer_role=user.role,
                      evidence_classification='REVIEWER_REFERENCE_EVALUATION', independent_validation=False,
                      coordinate_frame='original source grid', distance_units='mm', spacing_mm=spacing, shape=shape,
                      metrics=metrics, created_at=datetime.now(timezone.utc).isoformat())
        folder = storage / 'volumes' / run_id / 'reference_metrics'
        folder.mkdir(parents=True, exist_ok=True)
        reference, metadata = folder / record['reference_file'], folder / (identity + '.json')
        try:
            reference.write_bytes(data)
            audit(db, user.id, 'volume_reference_metrics_saved', case_id)
            db.commit()
            # Atomic metadata publication keeps incomplete writes out of listings.
            temporary = folder / (identity + '.tmp')
            temporary.write_text(json.dumps(record, allow_nan=False))
            temporary.replace(metadata)
        except Exception:
            db.rollback()
            reference.unlink(missing_ok=True)
            raise
        return record

    app.include_router(router)
