"""Immutable prepared-grid mask corrections and source-bound reference scoring."""
import base64
import hashlib
import json
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import numpy as np
from PIL import Image as Raster
from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .segmentation_metrics import segmentation_metrics


class PixelEdit(BaseModel):
    x: int
    y: int
    foreground: bool


class MaskSubmission(BaseModel):
    original_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    edits: list[PixelEdit] = Field(min_length=1, max_length=4096)
    note: str = Field(min_length=1, max_length=1000)


class ReferenceSubmission(BaseModel):
    image_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    mask_png_base64: str = Field(max_length=4000000)
    provenance: str = Field(min_length=10, max_length=2000)
    same_frame_confirmed: bool


def install(app, *, get_db, current_user, accessible_case, Image, AnalysisEvent, audit):
    def context(image_id, event_id, user, db, action):
        image = db.get(Image, image_id)
        event = db.get(AnalysisEvent, event_id)
        if image is None or event is None or event.image_id != image.id:
            raise HTTPException(404, 'Saved image analysis unavailable')
        accessible_case(image.case_id, user, db, required_action=action)
        path = Path(event.overlay_path).with_name(f'{event.id}.artery_mask.png')
        if not path.is_file():
            raise HTTPException(404, 'Saved artery mask unavailable')
        return image, path

    base = '/api/images/{image_id}/analyses/{event_id}/mask-review'

    @app.get(base)
    def listing(image_id: str, event_id: str, user=Depends(current_user), db=Depends(get_db)):
        image, path = context(image_id, event_id, user, db, 'read')
        with Raster.open(path) as mask:
            width, height = mask.size
        folder = path.parent / f'{event_id}.reviews'
        versions = sorted((json.loads(p.read_text()) for p in folder.glob('*.json')), key=lambda row: row['created_at'])
        return dict(original_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), width=width, height=height,
                    coordinate_frame='saved prepared mask pixels', versions=versions)

    @app.post(base, status_code=201)
    def save(image_id: str, event_id: str, body: MaskSubmission, user=Depends(current_user), db=Depends(get_db)):
        if user.role not in ('doctor', 'clinician', 'admin'):
            raise HTTPException(403, 'Reviewer role required')
        image, path = context(image_id, event_id, user, db, 'review')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != body.original_sha256:
            raise HTTPException(409, 'Original mask identity changed')
        with Raster.open(path) as raster:
            mask = np.asarray(raster.convert('L')) > 0
        for edit in body.edits:
            if not (0 <= edit.y < mask.shape[0] and 0 <= edit.x < mask.shape[1]):
                raise HTTPException(422, 'Pixel outside the prepared mask grid')
            mask[edit.y, edit.x] = edit.foreground
        folder = path.parent / f'{event_id}.reviews'
        folder.mkdir(exist_ok=True)
        version = uuid4().hex
        output = BytesIO()
        Raster.fromarray(mask.astype('uint8') * 255).save(output, format='PNG')
        payload = output.getvalue()
        record = dict(id=version, image_id=image_id, analysis_event_id=event_id, reviewer_id=user.id,
                      original_sha256=digest, edited_sha256=hashlib.sha256(payload).hexdigest(),
                      coordinate_frame='saved prepared mask pixels', edits=[e.model_dump() for e in body.edits],
                      note=body.note, created_at=datetime.now(timezone.utc).isoformat(), clinical_validated=False)
        (folder / f'{version}.png').write_bytes(payload)
        (folder / f'{version}.json').write_text(json.dumps(record))
        audit(db, user.id, f'image_mask_review_saved:{event_id}:{version}', image.case_id)
        db.commit()
        return record

    @app.get(base + '/{version}.png')
    def download(image_id: str, event_id: str, version: str, user=Depends(current_user), db=Depends(get_db)):
        _, path = context(image_id, event_id, user, db, 'read')
        if len(version) != 32 or any(c not in '0123456789abcdef' for c in version):
            raise HTTPException(404, 'Version unavailable')
        target = path.parent / f'{event_id}.reviews' / f'{version}.png'
        if not target.is_file():
            raise HTTPException(404, 'Version unavailable')
        return FileResponse(target, media_type='image/png')

    @app.post(base + '/reference-metrics')
    def score(image_id: str, event_id: str, body: ReferenceSubmission, user=Depends(current_user), db=Depends(get_db)):
        if user.role not in ('doctor', 'clinician', 'admin'):
            raise HTTPException(403, 'Reviewer role required')
        image, path = context(image_id, event_id, user, db, 'review')
        from .image_panels import paths
        from .saved_measurement import source_mask
        event = db.get(AnalysisEvent, event_id)
        original = paths(image, event)['original']
        if not body.same_frame_confirmed or hashlib.sha256(original.read_bytes()).hexdigest() != body.image_sha256:
            raise HTTPException(422, 'Confirm the exact source image and its SHA-256')
        try:
            payload = base64.b64decode(body.mask_png_base64, validate=True)
            with Raster.open(BytesIO(payload)) as raster:
                if raster.format != 'PNG' or raster.size != (image.width, image.height):
                    raise ValueError('Reference must be a PNG on the source image grid')
                array = np.asarray(raster.convert('L'))
                if not set(np.unique(array)) <= {0, 1, 255}:
                    raise ValueError('Reference must be binary')
                reference = array > 0
            prediction, _ = source_mask(image, path)
            metrics = segmentation_metrics(prediction, reference)
        except (ValueError, OSError) as error:
            raise HTTPException(422, str(error)) from error
        record = dict(id=uuid4().hex, image_id=image_id, analysis_event_id=event_id,
                      source_sha256=body.image_sha256, reference_sha256=hashlib.sha256(payload).hexdigest(),
                      provenance=body.provenance, reviewer_id=user.id, metrics=metrics,
                      evidence_class='reviewer_supplied_reference', independent_validation=False)
        folder = path.parent / f'{event_id}.references'
        folder.mkdir(exist_ok=True)
        (folder / (record['id'] + '.png')).write_bytes(payload)
        (folder / (record['id'] + '.json')).write_text(json.dumps(record))
        audit(db, user.id, f'image_reference_scored:{event_id}', image.case_id)
        db.commit()
        return record
