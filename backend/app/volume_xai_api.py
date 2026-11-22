"""Authorized API for volumetric explanations of saved 3D CTA runs.

Records: STORAGE/volumes/<run>/xai/<identity>.json, with the native-grid attribution
(<identity>.attr.nii.gz, uint8 0-255) and the 128^3 coarse map (<identity>.coarse.npy, float16)
beside them. Generation and verification run in the background, one at a time.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import Depends, HTTPException
from pydantic import BaseModel

from . import volume_xai as vx

LOG = logging.getLogger('corovision.operations')
LABELS = {'gradcam': 'Grad-CAM 3D', 'gradcampp': 'Grad-CAM++ 3D', 'occlusion': 'Occlusion sensitivity 3D'}
VOLUME_LOCK = threading.Lock()


class VolumeExplanationIn(BaseModel):
    model_config = {'extra': 'forbid'}
    method: Literal['gradcam', 'gradcampp', 'occlusion']


def run_folder(storage: Path, run_id: str) -> Path:
    return storage / 'volumes' / run_id


def records(storage: Path, run_id: str) -> list[dict]:
    folder = run_folder(storage, run_id) / 'xai'
    out = []
    for item in sorted(folder.glob('*.json')) if folder.exists() else []:
        try:
            out.append(json.loads(item.read_text()))
        except (OSError, ValueError):
            LOG.warning('volume_xai_record_unreadable path=%s', item.name)
    return sorted(out, key=lambda r: r.get('created_at', ''))


def record_path(storage: Path, run_id: str, record_id: str, suffix: str) -> Path:
    if not (record_id.isalnum() and len(record_id) == 64):
        raise HTTPException(404, 'Explanation not found')
    return run_folder(storage, run_id) / 'xai' / f'{record_id}{suffix}'


def heat_for_mpr(storage: Path, run_id: str, record_id: str):
    """(coarse 128^3 attribution, coarse affine) for slice sampling, after the saved hash is verified."""
    meta = record_path(storage, run_id, record_id, '.json')
    path = record_path(storage, run_id, record_id, '.coarse.npy')
    if not meta.is_file() or not path.is_file():
        raise HTTPException(404, 'Explanation not found')
    record = json.loads(meta.read_text())
    if record.get('run_id') != run_id or record.get('status') != 'ready' or not record.get('coarse_affine_ras_mm'):
        raise HTTPException(404, 'Explanation not available')
    blob = path.read_bytes()
    if hashlib.sha256(blob).hexdigest() != (record.get('artifact_sha256') or {}).get('coarse'):
        raise HTTPException(409, 'Saved attribution failed its integrity check')
    return np.load(path).astype(np.float32), np.asarray(record['coarse_affine_ras_mm'], dtype=float), bool(record.get('cropped'))


def install(app, *, get_db, current_user, accessible_case, case_out, storage: Path, audit, VolumeAnalysis):
    from .xai_api import recover_interrupted
    recovered = recover_interrupted((storage / 'volumes').glob('*/xai/*.json'))
    if recovered:
        LOG.warning('volume_xai_records_recovered count=%s', recovered)
    from .volume_inference import CHECKPOINT_SHA, MODEL_ID, checkpoint_path

    def now():
        return datetime.now(timezone.utc).isoformat()

    def load_run(case_id, run_id, user, db):
        case = accessible_case(case_id, user, db, required_action='read')
        row = db.get(VolumeAnalysis, run_id)
        if row is None or row.case_id != case.id:
            raise HTTPException(404, 'Volume analysis not found in this case')
        return case, row

    def eligibility(row):
        result = json.loads(row.result_json or '{}')
        folder = run_folder(storage, row.id)
        if row.status != 'completed':
            return 'UNAVAILABLE', 'The 3D analysis has not completed', result
        if row.model_key != 'imagecas' or result.get('checkpoint_sha256') != CHECKPOINT_SHA:
            return 'UNSUPPORTED', 'Volumetric explanation supports the retained ImageCAS 3D checkpoint only; no other model is substituted', result
        if not checkpoint_path().is_file():
            return 'UNAVAILABLE', 'The pinned 3D checkpoint is not installed', result
        if next(folder.glob('source.nii*'), None) is None or not (folder / 'outputs' / 'mask_source.nii.gz').is_file():
            return 'UNAVAILABLE', 'The saved source volume or vessel mask is unavailable', result
        return 'ELIGIBLE', None, result

    def write(run_id, record):
        folder = run_folder(storage, run_id) / 'xai'
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / f"{record['id']}.json"
        temp = target.with_suffix('.tmp')
        temp.write_text(json.dumps(record, allow_nan=False))
        temp.replace(target)

    def generate(record, source, mask, crop=None):
        try:
            with VOLUME_LOCK:
                model = vx.load_model(checkpoint_path(), CHECKPOINT_SHA)
                values, roi, _, meta = vx.attribution(source, model, record['identity']['method'], roi=crop)
                check = vx.alignment(roi, meta['coarse_affine'], meta['image'], mask, cropped=meta['cropped'])
                folder = run_folder(storage, record['run_id']) / 'xai'
                folder.mkdir(parents=True, exist_ok=True)
                coarse = folder / f"{record['id']}.coarse.npy"
                np.save(coarse, values.astype(np.float16))
                native_sha = vx.save_native(values, meta['coarse_affine'], meta['image'], folder / f"{record['id']}.attr.nii.gz", cropped=meta['cropped'])
            record.update(status='ready' if check['status'] == 'PASS' else 'failed',
                          error=None if check['status'] == 'PASS' else 'Spatial alignment check failed; attribution withheld',
                          alignment=check, summary=vx.summarize(values, roi),
                          target=dict(record['target'], target_score=meta['target_score'], target_layer=meta['target_layer'], roi_voxels=meta['roi_voxels']),
                          artifact_sha256=dict(native=native_sha, coarse=hashlib.sha256(coarse.read_bytes()).hexdigest()),
                          coarse_affine_ras_mm=np.asarray(meta['coarse_affine']).tolist(), cropped=meta['cropped'],
                          completed_at=now())
        except LookupError as error:
            record.update(status='not_evaluable', error=str(error))
        except (ValueError, RuntimeError, OSError, MemoryError) as error:
            LOG.warning('volume_xai_failed record=%s error=%s', record['id'], error)
            record.update(status='failed', error='The volumetric explanation could not be generated')
        finally:
            write(record['run_id'], record)

    def run_verification(record, source, crop=None):
        try:
            with VOLUME_LOCK:
                model = vx.load_model(checkpoint_path(), CHECKPOINT_SHA)
                from .volume_inference import prepare_input
                import torch
                _, _, prepared, _, _ = prepare_input(source, roi=crop)
                with torch.inference_mode():
                    roi = (model(torch.from_numpy(prepared)[None, None]).argmax(1)[0] == 1).numpy()
                values = np.load(record_path(storage, record['run_id'], record['id'], '.coarse.npy')).astype(np.float32)
                result = vx.verify(model, prepared, roi, values)
            record['verification'] = dict(result, status='completed', completed_at=now())
        except (ValueError, RuntimeError, OSError, MemoryError) as error:
            LOG.warning('volume_xai_verification_failed record=%s error=%s', record['id'], error)
            record['verification'] = dict(status='failed', error='Deletion/insertion could not be completed',
                                          deletion='NOT_TESTED', insertion='NOT_TESTED', randomization='NOT_TESTED')
        finally:
            write(record['run_id'], record)

    def can_generate(case, user, db):
        # Same rule as starting 3D inference (researcher/admin with upload access), or a case reviewer.
        if user.role in ('researcher', 'admin'):
            try:
                accessible_case(case.id, user, db, required_action='upload')
                return True
            except HTTPException:
                pass
        return bool(case_out(case, db, user)['permissions'].get('can_review'))

    base = '/api/cases/{case_id}/volumes/analyses/{run_id}/xai'

    @app.get(base)
    def volume_xai_overview(case_id: str, run_id: str, user=Depends(current_user), db=Depends(get_db)):
        case, row = load_run(case_id, run_id, user, db)
        state, reason, result = eligibility(row)
        return dict(case_id=case.id, run_id=row.id, modality='CTA', model_id=result.get('model_id', MODEL_ID),
                    checkpoint_sha256=result.get('checkpoint_sha256'), state=state, reason=reason,
                    target=dict(task='segmentation', target_id=vx.TARGET_ID, definition=vx.TARGET_DEFINITION),
                    methods=list(vx.METHOD_VERSIONS), method_versions=vx.METHOD_VERSIONS,
                    can_generate=can_generate(case, user, db) and state == 'ELIGIBLE',
                    records=records(storage, row.id), research_only=True)

    @app.post(base + '/explanations', status_code=202)
    def create_volume_explanation(case_id: str, run_id: str, data: VolumeExplanationIn, user=Depends(current_user), db=Depends(get_db)):
        case, row = load_run(case_id, run_id, user, db)
        if not can_generate(case, user, db):
            raise HTTPException(403, 'Analysis or review permission on this case is required')
        state, reason, result = eligibility(row)
        if state != 'ELIGIBLE':
            raise HTTPException(409, reason)
        fields = dict(case_id=case.id, volume_run_id=row.id, checkpoint_sha256=CHECKPOINT_SHA, task='segmentation',
                      target_type='roi', target_id=vx.TARGET_ID, method=data.method,
                      method_version=vx.METHOD_VERSIONS[data.method], target_definition_version='volume-targets-v1',
                      preprocessing_version=(result.get('preprocessing') or {}).get('version'), source_sha256=row.source_sha256)
        identity = hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()
        existing = record_path(storage, row.id, identity, '.json')
        if existing.is_file():
            record = json.loads(existing.read_text())
            if record.get('status') != 'failed':
                return record
        record = dict(id=identity, identity=fields, run_id=row.id, case_id=case.id, method_label=LABELS[data.method],
                      target=dict(task='segmentation', target_id=vx.TARGET_ID, definition=vx.TARGET_DEFINITION),
                      status='generating', created_at=now(), created_by=user.id,
                      verification=dict(status='not_run', deletion='NOT_TESTED', insertion='NOT_TESTED', randomization='NOT_TESTED'),
                      evidence_classification='LIVE_FROZEN_MODEL_INFERENCE', research_only=True, clinical_validated=False)
        write(row.id, record)
        audit(db, user.id, f'volume_xai_requested:{identity[:16]}:{row.id}', case.id)
        db.commit()
        folder = run_folder(storage, row.id)
        crop = (result.get('preprocessing') or {}).get('roi')
        model_mask = folder / 'outputs' / ('mask_source_raw.nii.gz' if (folder / 'outputs' / 'mask_source_raw.nii.gz').is_file() else 'mask_source.nii.gz')
        threading.Thread(target=generate, args=(record, next(folder.glob('source.nii*')), model_mask, crop), daemon=True).start()
        return record

    def own(case_id, run_id, record_id, user, db):
        case, row = load_run(case_id, run_id, user, db)
        path = record_path(storage, row.id, record_id, '.json')
        if not path.is_file():
            raise HTTPException(404, 'Explanation not found')
        record = json.loads(path.read_text())
        if record.get('case_id') != case.id or record.get('run_id') != row.id:
            raise HTTPException(404, 'Explanation not found')
        return case, row, record

    @app.get(base + '/explanations/{record_id}')
    def get_volume_explanation(case_id: str, run_id: str, record_id: str, user=Depends(current_user), db=Depends(get_db)):
        return own(case_id, run_id, record_id, user, db)[2]

    @app.post(base + '/explanations/{record_id}/verification', status_code=202)
    def verify_volume_explanation(case_id: str, run_id: str, record_id: str, user=Depends(current_user), db=Depends(get_db)):
        case, row, record = own(case_id, run_id, record_id, user, db)
        if not can_generate(case, user, db):
            raise HTTPException(403, 'Analysis or review permission on this case is required')
        if record.get('status') != 'ready':
            raise HTTPException(409, 'Only a ready explanation can be verified')
        if (record.get('verification') or {}).get('status') in ('running', 'completed'):
            return record
        record['verification'] = dict(status='running', deletion='NOT_TESTED', insertion='NOT_TESTED',
                                      randomization='NOT_TESTED', started_at=now())
        write(row.id, record)
        audit(db, user.id, f'volume_xai_verification:{record_id[:16]}', case.id)
        db.commit()
        crop = (json.loads(row.result_json or '{}').get('preprocessing') or {}).get('roi')
        threading.Thread(target=run_verification, args=(record, next(run_folder(storage, row.id).glob('source.nii*')), crop), daemon=True).start()
        return record
