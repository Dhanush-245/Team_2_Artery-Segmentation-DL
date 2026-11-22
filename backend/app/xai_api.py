"""Authorized API for case-specific explanations and the research-wide XAI summary.

Records live in STORAGE/xai/<run id>/<identity>.json with PNG artifacts beside them. A record is
reused only when its full identity matches. Nothing here edits a saved analysis run.
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
from fastapi.responses import Response
from pydantic import BaseModel

from . import xai_engine as engine

LOG = logging.getLogger('corovision.operations')
ARTIFACTS = ('heatmap', 'overlay', 'map')

# Study-level evidence recorded in reports/XAI_FAITHFULNESS_VERIFICATION.md (17 Nov) and
# reports/xai_faithfulness_20261122 (M3-02). Historical; never recomputed or relabelled here.
STUDY_EVIDENCE = [
    dict(id='xai-checkpoint-verification-20261117', date='2026-11-17', method='instance-mask-constrained Grad-CAM',
         cohort='one saved ARCADE run, 3 candidates', checks=[
             dict(target='C1', deletion='PASS', insertion='FAIL'),
             dict(target='C2', deletion='FAIL', insertion='FAIL'),
             dict(target='C3', deletion='PASS', insertion='PASS')],
         randomization='NOT_EVALUABLE', randomization_note='The randomized detector produced no matching detection.',
         overall='PARTIAL'),
    dict(id='m3-02-faithfulness-20261122', date='2026-11-22', method='saved (mask-constrained) and raw Grad-CAM / Grad-CAM++',
         cohort='ARCADE stenosis validation: 25 images (deletion/insertion), 10 images (cascading randomization)', checks=[
             dict(target='raw Grad-CAM', deletion='PASS', insertion='PASS', randomization='PASS', overall='PASS'),
             dict(target='raw Grad-CAM++', deletion='PASS', insertion='PASS', randomization='FAIL', overall='PARTIAL'),
             dict(target='mask-constrained Grad-CAM', deletion='PASS', insertion='PASS', randomization='FAIL', overall='PARTIAL'),
             dict(target='mask-constrained Grad-CAM++', deletion='PASS', insertion='PASS', randomization='FAIL', overall='PARTIAL')],
         deletion_insertion='PASS',
         deletion_insertion_note='All four maps beat an equal-area random order on both curves (one-sided Wilcoxon p < 0.001, n = 24-25).',
         randomization='PARTIAL',
         randomization_note='Only raw Grad-CAM decorrelates from randomized detectors (cascading median |rho| <= 0.2; full randomization 22/25).',
         overall='PARTIAL'),
    dict(id='m3-02-3d-demo-20261122', date='2026-11-22', method='3D Grad-CAM / Grad-CAM++ (ImageCAS U-Net)',
         cohort='one public CTA volume (heart-cropped demo case); sanity checks only', checks=[
             dict(target='Grad-CAM 3D', deletion='FAIL', insertion='FAIL', randomization='PARTIAL', overall='FAIL'),
             dict(target='Grad-CAM++ 3D', randomization='FAIL', overall='FAIL')],
         randomization='PARTIAL',
         randomization_note='Grad-CAM 3D decorrelates only after decoder layers are randomized (head-only rho 0.32); Grad-CAM++ 3D stays similar (rho 0.85).',
         deletion_insertion='FAIL', deletion_insertion_note='n = 1 volume; ranked block removal changed the target less than random removal.',
         overall='FAIL'),
]


def report_records(storage: Path, event_id: str) -> list[dict]:
    """Saved explanations of one run, frozen into a report snapshot (no storage paths)."""
    folder = storage / 'xai' / event_id
    rows = []
    for item in sorted(folder.glob('*.json')) if folder.exists() else []:
        try:
            record = json.loads(item.read_text())
        except (OSError, ValueError):
            continue
        rows.append({k: record.get(k) for k in ('id', 'status', 'method_label', 'identity', 'parameters', 'target',
                                                  'summary', 'artifact_sha256', 'verification', 'engine_version',
                                                  'created_at', 'completed_at', 'error', 'evidence_classification')})
    return sorted(rows, key=lambda r: r.get('created_at') or '')


def report_artifacts(storage: Path, snapshot: dict) -> dict:
    """Overlay files of the snapshot's ready records, verified against the recorded hashes."""
    out = {}
    for record in snapshot.get('xai') or []:
        if record.get('status') != 'ready':
            continue
        path = storage / 'xai' / record['identity']['run_id'] / f"{record['id']}.overlay.png"
        if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == (record.get('artifact_sha256') or {}).get('overlay'):
            out[f"xai_{record['identity']['target_id']}_{record['identity']['method']}_{record['id'][:8]}.overlay"] = path
    return out


class ExplanationIn(BaseModel):
    model_config = {'extra': 'forbid'}
    task: Literal['stenosis', 'segmentation']
    target_id: str
    method: Literal['gradcam', 'gradcampp', 'occlusion']
    constrained: bool = False


def recover_interrupted(paths) -> int:
    """After a restart no generation or verification thread survives: mark such records as interrupted."""
    count = 0
    for path in paths:
        try:
            record = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        changed = False
        if record.get('status') == 'generating':
            record.update(status='failed', error='Generation was interrupted by an application restart; generate again')
            changed = True
        verification = record.get('verification') or {}
        if verification.get('status') == 'running':
            record['verification'] = dict(status='failed', error='Verification was interrupted by an application restart; run it again',
                                          deletion='NOT_TESTED', insertion='NOT_TESTED', randomization='NOT_TESTED')
            changed = True
        if changed:
            path.write_text(json.dumps(record, allow_nan=False))
            count += 1
    return count


def install(app, *, get_db, current_user, accessible_case, case_out, storage: Path, audit, Image, AnalysisEvent, Case, event_out):
    recovered = recover_interrupted((storage / 'xai').glob('*/*.json'))
    if recovered:
        LOG.warning('xai_records_recovered count=%s', recovered)
    from . import trained_release as tr
    root = storage / 'xai'

    def now():
        return datetime.now(timezone.utc).isoformat()

    def checkpoints():
        return {m['task']: m['sha256'] for m in tr.RELEASE['models']}

    def threshold():
        return next(m['score_threshold'] for m in tr.RELEASE['models'] if m['task'] == 'stenosis')

    def load_run(case_id, event_id, user, db):
        case = accessible_case(case_id, user, db, required_action='read')
        event = db.get(AnalysisEvent, event_id)
        image = db.get(Image, event.image_id) if event else None
        if image is None or image.case_id != case.id:
            raise HTTPException(404, 'Saved analysis not found in this case')
        return case, image, event

    def eligibility(case, image, event):
        modality = json.loads(image.preprocessing_config_json or '{}').get('modality', case.modality)
        if modality != 'XCA' or case.anatomy != 'coronary':
            return 'UNSUPPORTED', 'Explanations for this engine apply to coronary XCA images only'
        if event.model_version != tr.RELEASE['version']:
            return 'UNSUPPORTED', f'Run model {event.model_version} differs from the installed release; no other model is substituted'
        if not tr.ready():
            return 'UNAVAILABLE', 'The verified frozen release checkpoints are not installed'
        if not Path(image.preview_path).is_file():
            return 'UNAVAILABLE', 'The prepared image of this run is unavailable'
        return 'ELIGIBLE', None

    def candidates_of(event):
        return [c for c in (event_out(event).get('structured_result') or {}).get('candidates', []) if c.get('candidate_id')]

    def folder(event_id):
        return root / event_id

    def records(event_id):
        path = folder(event_id)
        if not path.exists():
            return []
        out = []
        for item in sorted(path.glob('*.json')):
            try:
                out.append(json.loads(item.read_text()))
            except (OSError, ValueError):
                LOG.warning('xai_record_unreadable path=%s', item.name)
        return sorted(out, key=lambda r: r.get('created_at', ''))

    def record_identity(case, image, event, data: ExplanationIn, source_sha):
        task_checkpoint = checkpoints()['stenosis' if data.task == 'stenosis' else 'syntax']
        params = dict(constrained=bool(data.constrained and data.task == 'stenosis' and data.method != 'occlusion'),
                      grid=engine.OCCLUSION_GRID if data.method == 'occlusion' else None)
        fields = dict(case_id=case.id, image_id=image.id, run_id=event.id, checkpoint_sha256=task_checkpoint,
                      task=data.task, target_type='candidate' if data.task == 'stenosis' else 'roi',
                      target_id=data.target_id, method=data.method, method_version=engine.METHOD_VERSIONS[data.method],
                      target_definition_version=engine.TARGET_DEFINITION_VERSION,
                      preprocessing_version=engine.PREPROCESSING_VERSION, source_sha256=source_sha,
                      parameters_hash=hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16])
        return engine.identity(**fields), fields, params

    def write_record(event_id, record):
        path = folder(event_id)
        path.mkdir(parents=True, exist_ok=True)
        target = path / f"{record['id']}.json"
        temp = target.with_suffix('.tmp')
        temp.write_text(json.dumps(record, allow_nan=False))
        temp.replace(target)

    def generate(record, prepared, candidate):
        task, method = record['identity']['task'], record['identity']['method']
        try:
            with engine.GENERATION_LOCK, tr.LOCK:
                if task == 'stenosis':
                    values, meta = engine.stenosis_attribution(prepared, candidate, method, threshold())
                else:
                    values, meta = engine.segmentation_attribution(prepared, method)
            mask = meta.pop('predicted_mask', None)
            if not np.isfinite(values).all():
                raise ValueError('Attribution contains non-finite values')
            if record['parameters']['constrained'] and mask is not None:
                values = values * mask
            values = engine._normalize(values)
            if float(values.max()) <= 0:
                record.update(status='failed', error='The attribution is zero everywhere for this target')
                return
            path = folder(record['run_id'])
            path.mkdir(parents=True, exist_ok=True)
            hashes = {}
            for name, blob in (('map', engine.map_png(values)), ('heatmap', engine.heatmap_png(values)),
                               ('overlay', engine.overlay_png(prepared, values))):
                (path / f"{record['id']}.{name}.png").write_bytes(blob)
                hashes[name] = hashlib.sha256(blob).hexdigest()
            reference = engine._polygon_mask(candidate['polygon_prepared_xy']) if candidate else mask
            record.update(status='ready', artifact_sha256=hashes, target=dict(record['target'], **meta),
                          summary=engine.summarize(values, reference), completed_at=now())
        except LookupError as error:
            record.update(status='not_evaluable', error=str(error))
        except (ValueError, RuntimeError, OSError) as error:
            LOG.warning('xai_generation_failed record=%s error=%s', record['id'], error)
            record.update(status='failed', error='The explanation could not be generated for this target')
        finally:
            write_record(record['run_id'], record)

    def run_verification(record, prepared, candidate):
        try:
            from PIL import Image as PILImage
            with PILImage.open(folder(record['run_id']) / f"{record['id']}.map.png") as opened:
                values = np.asarray(opened, dtype=np.float32) / 255.
            with engine.GENERATION_LOCK, tr.LOCK:
                result = engine.verify(prepared, record['identity']['task'], values, candidate, threshold())
            record['verification'] = dict(result, status='completed', completed_at=now())
        except (ValueError, RuntimeError, OSError, LookupError) as error:
            LOG.warning('xai_verification_failed record=%s error=%s', record['id'], error)
            record['verification'] = dict(status='failed', error='Deletion/insertion could not be completed',
                                          deletion='NOT_TESTED', insertion='NOT_TESTED', randomization='NOT_TESTED')
        finally:
            write_record(record['run_id'], record)

    def can_generate(case, user, db):
        permissions = case_out(case, db, user)['permissions']
        return bool(permissions.get('can_run_analysis') or permissions.get('can_review'))

    def public(record):
        return {k: v for k, v in record.items() if k != 'internal'}

    @app.get('/api/cases/{case_id}/xai/{event_id}')
    def xai_overview(case_id: str, event_id: str, user=Depends(current_user), db=Depends(get_db)):
        case, image, event = load_run(case_id, event_id, user, db)
        state, reason = eligibility(case, image, event)
        candidates = candidates_of(event)
        targets = [dict(task='stenosis', target_id=c['candidate_id'], model_score=c.get('model_score'),
                        bbox_prepared_xyxy=c.get('bbox_prepared_xyxy'), mask_pixels=c.get('mask_pixels'))
                   for c in candidates]
        targets.append(dict(task='segmentation', target_id=engine.SEGMENTATION_TARGET))
        return dict(case_id=case.id, case_code=case.case_code, image_id=image.id, run_id=event.id,
                    modality='XCA', model_version=event.model_version, engine_version=engine.ENGINE_VERSION,
                    checkpoints=checkpoints(), state=state, reason=reason,
                    zero_candidates=not candidates, targets=targets, methods=engine.METHODS,
                    method_versions=engine.METHOD_VERSIONS, target_definitions=engine.TARGET_DEFINITIONS,
                    can_generate=can_generate(case, user, db) and state == 'ELIGIBLE',
                    records=[public(r) for r in records(event.id)], study_evidence=STUDY_EVIDENCE,
                    research_only=True)

    @app.post('/api/cases/{case_id}/xai/{event_id}/explanations', status_code=201)
    def create_explanation(case_id: str, event_id: str, data: ExplanationIn,
                           user=Depends(current_user), db=Depends(get_db)):
        case, image, event = load_run(case_id, event_id, user, db)
        if not can_generate(case, user, db):
            raise HTTPException(403, 'Analysis or review permission on this case is required')
        state, reason = eligibility(case, image, event)
        if state != 'ELIGIBLE':
            raise HTTPException(409, reason)
        candidate = None
        if data.task == 'stenosis':
            candidate = next((c for c in candidates_of(event) if c['candidate_id'] == data.target_id), None)
            if candidate is None:
                raise HTTPException(422, 'The target is not a retained candidate of this saved run')
        elif data.target_id != engine.SEGMENTATION_TARGET:
            raise HTTPException(422, 'Unknown segmentation target')
        prepared = Path(image.preview_path)
        source_sha = hashlib.sha256(prepared.read_bytes()).hexdigest()
        identity, fields, params = record_identity(case, image, event, data, source_sha)
        existing = folder(event.id) / f'{identity}.json'
        if existing.is_file():
            record = json.loads(existing.read_text())
            if record.get('status') not in ('failed',):
                return public(record)
        record = dict(id=identity, identity=fields, run_id=event.id, case_id=case.id, parameters=params,
                      target=dict(task=data.task, target_id=data.target_id,
                                  definition=engine.TARGET_DEFINITIONS[data.task],
                                  model_score=candidate.get('model_score') if candidate else None),
                      method_label={'gradcam': 'Grad-CAM', 'gradcampp': 'Grad-CAM++', 'occlusion': 'Occlusion sensitivity'}[data.method]
                      + (' (mask-constrained)' if params['constrained'] else ''),
                      engine_version=engine.ENGINE_VERSION, status='generating', created_at=now(), created_by=user.id,
                      verification=dict(status='not_run', deletion='NOT_TESTED', insertion='NOT_TESTED', randomization='NOT_TESTED'),
                      evidence_classification='LIVE_FROZEN_MODEL_INFERENCE', research_only=True, clinical_validated=False)
        write_record(event.id, record)
        audit(db, user.id, f'xai_explanation_requested:{identity[:16]}:{event.id}', case.id)
        db.commit()
        if data.method == 'occlusion':
            threading.Thread(target=generate, args=(record, prepared, candidate), daemon=True).start()
            return public(record)
        generate(record, prepared, candidate)
        return public(record)

    def own_record(case_id, event_id, record_id, user, db):
        case, image, event = load_run(case_id, event_id, user, db)
        if not record_id.isalnum() or len(record_id) != 64:
            raise HTTPException(404, 'Explanation not found')
        path = folder(event.id) / f'{record_id}.json'
        if not path.is_file():
            raise HTTPException(404, 'Explanation not found')
        record = json.loads(path.read_text())
        if record.get('case_id') != case.id or record.get('run_id') != event.id:
            raise HTTPException(404, 'Explanation not found')
        return case, image, event, record

    @app.get('/api/cases/{case_id}/xai/{event_id}/explanations/{record_id}')
    def get_explanation(case_id: str, event_id: str, record_id: str, user=Depends(current_user), db=Depends(get_db)):
        return public(own_record(case_id, event_id, record_id, user, db)[3])

    @app.get('/api/cases/{case_id}/xai/{event_id}/explanations/{record_id}/{artifact}.png')
    def get_artifact(case_id: str, event_id: str, record_id: str, artifact: str,
                     user=Depends(current_user), db=Depends(get_db)):
        if artifact not in ARTIFACTS:
            raise HTTPException(404, 'Artifact not found')
        _, _, event, record = own_record(case_id, event_id, record_id, user, db)
        path = folder(event.id) / f'{record_id}.{artifact}.png'
        if record.get('status') != 'ready' or not path.is_file():
            raise HTTPException(404, 'Artifact not available')
        blob = path.read_bytes()
        if hashlib.sha256(blob).hexdigest() != (record.get('artifact_sha256') or {}).get(artifact):
            raise HTTPException(409, 'Saved artifact failed its integrity check')
        return Response(blob, media_type='image/png', headers={'Cache-Control': 'private, max-age=300'})

    @app.post('/api/cases/{case_id}/xai/{event_id}/explanations/{record_id}/verification', status_code=202)
    def verify_explanation(case_id: str, event_id: str, record_id: str, user=Depends(current_user), db=Depends(get_db)):
        case, image, event, record = own_record(case_id, event_id, record_id, user, db)
        if not can_generate(case, user, db):
            raise HTTPException(403, 'Analysis or review permission on this case is required')
        if record.get('status') != 'ready':
            raise HTTPException(409, 'Only a ready explanation can be verified')
        if (record.get('verification') or {}).get('status') in ('running', 'completed'):
            return public(record)
        candidate = None
        if record['identity']['task'] == 'stenosis':
            candidate = next((c for c in candidates_of(event) if c['candidate_id'] == record['identity']['target_id']), None)
        record['verification'] = dict(status='running', deletion='NOT_TESTED', insertion='NOT_TESTED',
                                      randomization='NOT_TESTED', started_at=now())
        write_record(event.id, record)
        audit(db, user.id, f'xai_verification_requested:{record_id[:16]}', case.id)
        db.commit()
        threading.Thread(target=run_verification, args=(record, Path(image.preview_path), candidate), daemon=True).start()
        return public(record)

    @app.get('/api/xai/summary')
    def xai_summary(user=Depends(current_user), db=Depends(get_db)):
        from sqlalchemy import select
        rows, coverage = [], dict(runs=0, eligible_runs=0, zero_candidate_runs=0, runs_with_explanations=0)
        for case in db.scalars(select(Case).where(Case.deleted_at.is_(None))):
            try:
                accessible_case(case.id, user, db, required_action='read')
            except HTTPException:
                continue
            for image in db.scalars(select(Image).where(Image.case_id == case.id)):
                for event in db.scalars(select(AnalysisEvent).where(AnalysisEvent.image_id == image.id)):
                    coverage['runs'] += 1
                    state, _ = eligibility(case, image, event)
                    coverage['eligible_runs'] += state == 'ELIGIBLE'
                    coverage['zero_candidate_runs'] += not candidates_of(event)
                    saved = records(event.id)
                    coverage['runs_with_explanations'] += bool(saved)
                    for r in saved:
                        v = r.get('verification') or {}
                        rows.append(dict(case_id=case.id, case_code=case.case_code, image_id=image.id, run_id=event.id,
                                         record_id=r['id'], task=r['identity']['task'], target_id=r['identity']['target_id'],
                                         method=r['identity']['method'], method_label=r.get('method_label'),
                                         constrained=r['parameters'].get('constrained'), status=r.get('status'),
                                         deletion=v.get('deletion', 'NOT_TESTED'), insertion=v.get('insertion', 'NOT_TESTED'),
                                         randomization=v.get('randomization', 'NOT_TESTED'),
                                         energy_inside_target_mask=(r.get('summary') or {}).get('energy_inside_target_mask'),
                                         created_at=r.get('created_at')))
        by_method = {}
        for row in rows:
            key = row['method_label'] or row['method']
            entry = by_method.setdefault(key, dict(records=0, ready=0, verified=0, deletion_pass=0, insertion_pass=0))
            entry['records'] += 1
            entry['ready'] += row['status'] == 'ready'
            entry['verified'] += row['deletion'] in ('PASS', 'FAIL')
            entry['deletion_pass'] += row['deletion'] == 'PASS'
            entry['insertion_pass'] += row['insertion'] == 'PASS'
        from .models import VolumeAnalysis
        from .volume_xai_api import records as volume_records
        volume_rows, volume_runs = [], 0
        for case in db.scalars(select(Case).where(Case.deleted_at.is_(None))):
            try:
                accessible_case(case.id, user, db, required_action='read')
            except HTTPException:
                continue
            for run in db.scalars(select(VolumeAnalysis).where(VolumeAnalysis.case_id == case.id, VolumeAnalysis.status == 'completed')):
                volume_runs += 1
                for r in volume_records(storage, run.id):
                    v = r.get('verification') or {}
                    volume_rows.append(dict(case_id=case.id, case_code=case.case_code, run_id=run.id, record_id=r['id'],
                                            method_label=r.get('method_label'), status=r.get('status'),
                                            alignment=(r.get('alignment') or {}).get('status', 'NOT_TESTED'),
                                            deletion=v.get('deletion', 'NOT_TESTED'), insertion=v.get('insertion', 'NOT_TESTED'),
                                            created_at=r.get('created_at')))
        return dict(engine_version=engine.ENGINE_VERSION, method_versions=engine.METHOD_VERSIONS,
                    volume=dict(runs=volume_runs, records=volume_rows),
                    target_definitions=engine.TARGET_DEFINITIONS, coverage=coverage, by_method=by_method,
                    records=rows, study_evidence=STUDY_EVIDENCE, volume_xai='IMPLEMENTED' if volume_rows or volume_runs else 'NO_3D_RUNS',
                    scope='Only cases you can open are counted.', research_only=True)
