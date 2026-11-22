"""Volumetric XAI: alignment, MPR overlay, authorization and persistence (synthetic geometry only)."""
import hashlib
import json
import time
from uuid import uuid4

import nibabel as nib
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import volume_xai as vx
from app.main import STORAGE, app
from app.volume_inference import CHECKPOINT_SHA
from app.volume_mpr import render_mpr
from test_rbac_system import make_user

pytest.importorskip('torch')


def _nifti(path, data):
    image = nib.Nifti1Image(data, np.diag([0.5, 0.5, 1.0, 1.0]))
    image.header.set_xyzt_units('mm')
    nib.save(image, str(path))


def test_mpr_draws_heat_only_where_attribution_is_high(tmp_path):
    source, mask = tmp_path / 's.nii.gz', tmp_path / 'm.nii.gz'
    _nifti(source, np.full((16, 16, 8), 300, np.int16))
    _nifti(mask, np.zeros((16, 16, 8), np.uint8))
    image = nib.load(str(source))
    coarse_affine = image.affine @ np.diag([*((np.array(image.shape) - 1) / 127), 1.])
    coarse = np.zeros((128, 128, 128), np.float32)
    coarse[:40, :40, :] = 0.5   # covers native voxels x,y < ~5
    plain = render_mpr(source, mask, axis=2, index=4, window=800, level=300, opacity=.5)
    hot = render_mpr(source, mask, axis=2, index=4, window=800, level=300, opacity=.5, heat=(coarse, coarse_affine), heat_opacity=1.0)
    assert plain != hot
    from io import BytesIO
    from PIL import Image
    pixels = np.asarray(Image.open(BytesIO(hot)).convert('RGB')).astype(int)
    assert pixels[-2, 1][0] > pixels[-2, 1][2]            # heated corner (after the display transpose/flip)
    assert abs(pixels[2, 12][0] - pixels[2, 12][2]) < 2   # unheated region stays grey


def test_slice_sampling_matches_the_native_resample(tmp_path):
    from app.volume_mpr import slice_from_coarse
    image = nib.Nifti1Image(np.zeros((24, 20, 12), np.float32), np.array([[0.6, 0, 0, -10], [0, 0.6, 0, 5], [0, 0, 1.4, 2], [0, 0, 0, 1]]))
    coarse_affine = image.affine @ np.diag([*((np.array(image.shape) - 1) / 127), 1.])
    coarse = np.random.default_rng(1).random((128, 128, 128)).astype(np.float32)
    native = vx.to_native(coarse, coarse_affine, image, order=1)
    for axis, index in ((0, 7), (1, 3), (2, 11)):
        assert np.abs(slice_from_coarse(coarse, coarse_affine, image, axis, index) - np.clip(np.take(native, index, axis=axis), 0, 1)).max() < 1e-5


def test_alignment_passes_for_the_same_transform_and_fails_otherwise(tmp_path):
    image = nib.Nifti1Image(np.zeros((20, 20, 10), np.float32), np.diag([0.7, 0.7, 1.5, 1.0]))
    coarse_affine = image.affine @ np.diag([*((np.array(image.shape) - 1) / 127), 1.])
    roi = np.zeros((128, 128, 128), bool)
    roi[40:80, 40:80, 40:80] = True
    saved = tmp_path / 'mask.nii.gz'
    nib.save(nib.Nifti1Image(np.uint8(vx.to_native(roi.astype(np.uint8), coarse_affine, image, 0) > 0), image.affine), str(saved))
    assert vx.alignment(roi, coarse_affine, image, saved)['status'] == 'PASS'
    shifted = np.roll(roi, 30, axis=0)
    assert vx.alignment(shifted, coarse_affine, image, saved)['status'] == 'FAIL'


def _volume_run(client, headers, model_key='imagecas', checkpoint=CHECKPOINT_SHA):
    from app.database import SessionLocal
    from app.models import VolumeAnalysis
    case = client.post('/api/cases', headers=headers, json={'case_code': 'VXAI-' + uuid4().hex[:6], 'modality': 'CTA', 'anatomy': 'coronary'}).json()
    with SessionLocal() as db:
        row = VolumeAnalysis(case_id=case['id'], created_by=client.get('/api/auth/me', headers=headers).json()['id'], status='completed',
                             source_sha256='0' * 64, model_key=model_key, input_kind='medical_study',
                             result_json=json.dumps({'checkpoint_sha256': checkpoint, 'model_id': 'x', 'preprocessing': {'version': 'p1'}}))
        db.add(row); db.commit()
        run_id = row.id
    folder = STORAGE / 'volumes' / run_id
    (folder / 'outputs').mkdir(parents=True, exist_ok=True)
    _nifti(folder / 'source.nii.gz', np.full((16, 16, 8), 300, np.int16))
    _nifti(folder / 'outputs' / 'mask_source.nii.gz', np.zeros((16, 16, 8), np.uint8))
    return case, run_id


@pytest.fixture()
def fake_volume(monkeypatch, tmp_path):
    checkpoint = tmp_path / 'imagecas128.pt'
    checkpoint.write_bytes(b'stand-in')
    monkeypatch.setattr('app.volume_inference.checkpoint_path', lambda: checkpoint)
    monkeypatch.setattr(vx, 'load_model', lambda path, sha: object())

    def attribution(source, model, method, roi=None):
        image = nib.load(str(source))
        values = np.zeros((128, 128, 128), np.float32); values[10:20, 10:20, 10:20] = 1
        roi = values > 0
        coarse_affine = image.affine @ np.diag([*((np.array(image.shape) - 1) / 127), 1.])
        return values, roi, values, dict(target_score=2.0, target_layer='dec[1]', roi_voxels=int(roi.sum()), coarse_affine=coarse_affine, image=image, cropped=False)
    monkeypatch.setattr(vx, 'attribution', attribution)
    monkeypatch.setattr(vx, 'alignment', lambda *a, **k: dict(status='PASS', mask_dice_vs_saved=1.0))


def _wait(client, url, headers):
    for _ in range(100):
        body = client.get(url, headers=headers).json()
        if body['status'] != 'generating':
            return body
        time.sleep(0.05)
    raise AssertionError('generation did not finish')


def test_volume_explanation_is_generated_saved_and_protected(fake_volume):
    with TestClient(app) as client:
        _, owner = make_user(f'vx-owner-{uuid4().hex}@example.org', 'researcher')
        _, outsider = make_user(f'vx-out-{uuid4().hex}@example.org', 'researcher')
        case, run = _volume_run(client, owner)
        base = f"/api/cases/{case['id']}/volumes/analyses/{run}/xai"
        overview = client.get(base, headers=owner).json()
        assert overview['state'] == 'ELIGIBLE' and overview['target']['target_id'] == 'vessel_mask'
        assert client.get(base, headers=outsider).status_code == 404
        started = client.post(base + '/explanations', headers=owner, json={'method': 'gradcam'})
        assert started.status_code == 202
        record = _wait(client, f"{base}/explanations/{started.json()['id']}", owner)
        assert record['status'] == 'ready' and record['alignment']['status'] == 'PASS'
        assert record['identity']['checkpoint_sha256'] == CHECKPOINT_SHA
        native = STORAGE / 'volumes' / run / 'xai' / f"{record['id']}.attr.nii.gz"
        assert hashlib.sha256(native.read_bytes()).hexdigest() == record['artifact_sha256']['native']
        coarse = STORAGE / 'volumes' / run / 'xai' / f"{record['id']}.coarse.npy"
        mpr = f"/api/cases/{case['id']}/volumes/analyses/{run}/mpr.png?axis=2&index=4&xai={record['id']}"
        assert client.get(mpr, headers=owner).status_code == 200
        assert client.get(mpr.replace(record['id'], 'f' * 64), headers=owner).status_code == 404
        coarse.write_bytes(b'tampered')
        assert client.get(mpr, headers=owner).status_code == 409
        again = client.post(base + '/explanations', headers=owner, json={'method': 'gradcam'}).json()
        assert again['id'] == record['id']


def test_other_3d_models_are_unsupported(fake_volume):
    with TestClient(app) as client:
        _, owner = make_user(f'vx-model-{uuid4().hex}@example.org', 'researcher')
        case, run = _volume_run(client, owner, model_key='aorta_aligned', checkpoint='1' * 64)
        base = f"/api/cases/{case['id']}/volumes/analyses/{run}/xai"
        assert client.get(base, headers=owner).json()['state'] == 'UNSUPPORTED'
        assert client.post(base + '/explanations', headers=owner, json={'method': 'gradcam'}).status_code == 409


def test_interrupted_work_is_recovered_after_restart(tmp_path):
    from app.xai_api import recover_interrupted
    stuck = tmp_path / 'a.json'
    stuck.write_text(json.dumps({'status': 'generating', 'verification': {'status': 'not_run'}}))
    running = tmp_path / 'b.json'
    running.write_text(json.dumps({'status': 'ready', 'verification': {'status': 'running', 'deletion': 'NOT_TESTED'}}))
    done = tmp_path / 'c.json'
    done.write_text(json.dumps({'status': 'ready', 'verification': {'status': 'completed', 'deletion': 'PASS'}}))
    assert recover_interrupted([stuck, running, done]) == 2
    assert json.loads(stuck.read_text())['status'] == 'failed'
    assert json.loads(running.read_text())['verification']['status'] == 'failed'
    assert json.loads(done.read_text())['verification']['deletion'] == 'PASS'
