"""Versioned reviewer corrections to a saved 3D vessel mask.

A reviewer may paint source-grid voxels or exclude connected components of the predicted mask (for example a fragment that is
clearly not coronary). Each save writes a new immutable version: a NIfTI on the original source grid plus a
JSON record naming the reviewer, time, note, the excluded components and the hashes of the original and
edited masks. Versions are always computed from the model's original mask, never from each other, so a
version states exactly what was removed. The original model mask, its measurements and every exported report
stay untouched; viewers opt in to a version with `mask_version`.
"""
import hashlib
import json
from functools import lru_cache
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from uuid import uuid4

import nibabel as nib
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from scipy.ndimage import label

VERSION_WRITE_LOCK = Lock()

SCHEMA = 'corovision.volume-mask-review.v1'


class VoxelEdit(BaseModel):
    model_config = {'extra': 'forbid'}
    ijk: tuple[int, int, int]
    foreground: bool


class MaskReviewIn(BaseModel):
    model_config = {'extra': 'forbid'}
    remove_components: list[int] = Field(default_factory=list, max_length=64)
    voxel_edits: list[VoxelEdit] = Field(default_factory=list, max_length=512)
    note: str = Field(default='', max_length=1000)
    original_mask_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


def components(mask_path: Path):
    stat = Path(mask_path).stat()
    return _components(str(mask_path), stat.st_mtime_ns, stat.st_size)


@lru_cache(maxsize=4)
def _components(mask_path: str, mtime_ns: int, size: int):
    """Connected components (26-connectivity) ranked by size, rank 1 largest, with positions in voxel and world space.

    Labelling runs on the bounding box of the prediction, not the whole CT volume, so large scans stay quick.
    Returns (image, labels_in_box, box_slices, ordered, rows)."""
    image = nib.load(mask_path)
    mask = np.asarray(image.dataobj) > 0
    if not mask.any():
        return image, np.zeros((0, 0, 0), np.int32), (slice(0, 0),) * 3, np.array([], dtype=int), []
    box = tuple(slice(int(np.flatnonzero(mask.any(axis=tuple(a for a in range(3) if a != axis)))[0]),
                      int(np.flatnonzero(mask.any(axis=tuple(a for a in range(3) if a != axis)))[-1]) + 1) for axis in range(3))
    labels, _ = label(mask[box], structure=np.ones((3, 3, 3), dtype=np.uint8))
    sizes = np.bincount(labels.ravel())[1:]
    ordered = np.argsort(sizes)[::-1]
    origin = np.array([item.start for item in box])
    rows = []
    for rank, index in enumerate(ordered, start=1):
        voxels = np.argwhere(labels == int(index) + 1)
        centre = voxels.mean(axis=0) + origin
        rows.append(dict(rank=rank, voxels=int(sizes[index]), centroid_ijk=[int(round(v)) for v in centre],
                         centroid_ras_mm=[round(float(v), 2) for v in nib.affines.apply_affine(image.affine, centre)]))
    return image, labels, box, ordered, rows


@lru_cache(maxsize=16)
def _sha256(path: str, mtime_ns: int, size: int):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sha256(path: Path):
    stat = Path(path).stat()
    return _sha256(str(path), stat.st_mtime_ns, stat.st_size)


def versions(storage: Path, run_id: str):
    folder = storage / 'volumes' / run_id / 'mask_review'
    if not folder.is_dir():
        return []
    return sorted((json.loads(item.read_text()) for item in folder.glob('v*.json')), key=lambda row: row['version'])


def mask_for_version(storage: Path, run_id: str, version: int) -> Path:
    path = storage / 'volumes' / run_id / 'mask_review' / f'v{version}.nii.gz'
    if not path.is_file():
        raise HTTPException(404, 'Reviewed mask version not found')
    return path


def install(app, *, get_db, current_user, accessible_case, storage: Path, audit, VolumeAnalysis, reviewer_roles):
    router = APIRouter(prefix='/api/cases/{case_id}/volumes/analyses/{run_id}/mask-review', tags=['Reviewer 3D mask versions'])

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
        row, mask = completed_run(case_id, run_id, db)
        can_review = user.role in reviewer_roles
        if can_review:
            try:
                accessible_case(case_id, user, db, required_action='review')
            except HTTPException as exc:
                if exc.status_code != 403:
                    raise
                can_review = False
        _, _, _, _, rows = components(mask)
        history = versions(storage, run_id)
        return dict(schema_version=SCHEMA, original_mask_sha256=sha256(mask), components=rows, versions=history,
                    current_version=history[-1]['version'] if history else None, can_review=can_review,
                    note='The model mask is never changed. A version records reviewer component exclusions and source-grid voxel edits.')

    @router.post('', status_code=201)
    def create(case_id: str, run_id: str, body: MaskReviewIn, user=Depends(current_user), db=Depends(get_db)):
        if user.role not in reviewer_roles:
            raise HTTPException(403, 'Only doctors, clinicians and administrators save mask corrections')
        case = accessible_case(case_id, user, db, required_action='review')
        row, mask = completed_run(case_id, run_id, db)
        original_hash = sha256(mask)
        if body.original_mask_sha256 != original_hash:
            raise HTTPException(409, 'The saved mask changed since it was loaded; reload before editing')
        image, labels, box, ordered, rows = components(mask)
        removed = sorted(set(body.remove_components))
        if not removed and not body.voxel_edits:
            raise HTTPException(422, 'Choose a component or paint at least one voxel')
        valid = {item['rank'] for item in rows}
        if not set(removed) <= valid:
            raise HTTPException(422, 'Unknown component rank')
        if valid and set(removed) == valid and not body.voxel_edits:
            raise HTTPException(422, 'At least one component must remain')
        edited = np.asarray(image.dataobj) > 0
        removed_voxels = 0
        inside = edited[box]
        for rank in removed:
            selector = labels == int(ordered[rank - 1]) + 1
            removed_voxels += int(selector.sum())
            inside &= ~selector
        edited[box] = inside
        voxel_edits = {}
        for edit in body.voxel_edits:
            if any(index < 0 or index >= size for index, size in zip(edit.ijk, edited.shape)):
                raise HTTPException(422, 'Painted voxel is outside the saved source grid')
            voxel_edits[edit.ijk] = edit.foreground
        painted = []
        added_voxels = 0
        for ijk, foreground in voxel_edits.items():
            if bool(edited[ijk]) == foreground:
                continue
            edited[ijk] = foreground
            added_voxels += int(foreground)
            removed_voxels += int(not foreground)
            painted.append(dict(ijk=ijk, foreground=foreground))
        if not np.any(edited):
            raise HTTPException(422, 'At least one foreground voxel must remain')
        if not (removed_voxels or added_voxels):
            raise HTTPException(422, 'The correction did not change any voxels')
        folder = storage / 'volumes' / row.id / 'mask_review'
        folder.mkdir(parents=True, exist_ok=True)
        edited_image = nib.Nifti1Image(edited.astype(np.uint8), image.affine, image.header)
        edited_image.set_data_dtype(np.uint8)
        with VERSION_WRITE_LOCK:
            history = versions(storage, run_id)
            number = (history[-1]['version'] if history else 0) + 1
            edited_path = folder / f'v{number}.nii.gz'
            draft = folder / f'.{uuid4().hex}.nii.gz'
            metadata = folder / f'.{uuid4().hex}.json'
            try:
                nib.save(edited_image, draft)
                record = dict(schema_version=SCHEMA, id=uuid4().hex, version=number, case_id=case.id, analysis_run_id=row.id,
                              removed_components=removed, removed_voxels=removed_voxels, added_voxels=added_voxels,
                              voxel_edits=painted, remaining_voxels=int(edited.sum()), note=body.note.strip(),
                              original_mask_sha256=original_hash, edited_mask_sha256=sha256(draft),
                              reviewer_id=user.id, reviewer_role=user.role, created_at=datetime.now(timezone.utc).isoformat(),
                              original_mask_unchanged=True, clinical_validated=False)
                metadata.write_text(json.dumps(record))
                audit(db, user.id, f'volume_mask_review_saved:{row.id}:v{number}', case.id)
                db.commit()
                draft.replace(edited_path)
                metadata.replace(folder / f'v{number}.json')
            finally:
                draft.unlink(missing_ok=True)
                metadata.unlink(missing_ok=True)
        return record

    @router.get('/versions/{version}/mask.nii.gz')
    def download(case_id: str, run_id: str, version: int, user=Depends(current_user), db=Depends(get_db)):
        accessible_case(case_id, user, db)
        completed_run(case_id, run_id, db)
        return FileResponse(mask_for_version(storage, run_id, version), media_type='application/gzip',
                            filename=f'reviewed-mask-v{version}.nii.gz')

    app.include_router(router)
