import json
from uuid import uuid4

import nibabel as nib
import numpy as np
from fastapi.testclient import TestClient

from app.main import STORAGE, app
from test_rbac_system import make_user
from test_volume_xai import _volume_run


def _two_components(run):
    path = STORAGE / 'volumes' / run / 'outputs' / 'mask_source.nii.gz'
    image = nib.load(path)
    mask = np.zeros(image.shape, np.uint8)
    mask[2:8, 2:8, 2:6] = 1     # large component
    mask[12:14, 12:14, 0:2] = 1  # small fragment, 2 x 2 x 2 voxels
    nib.save(nib.Nifti1Image(mask, image.affine, image.header), path)
    return path


def test_mask_corrections_are_versioned_and_never_change_the_model_mask():
    with TestClient(app) as client:
        _, doctor = make_user(f'mr-doc-{uuid4().hex}@example.org', 'doctor')
        case, run = _volume_run(client, doctor)
        path = _two_components(run)
        original = path.read_bytes()
        base = f"/api/cases/{case['id']}/volumes/analyses/{run}/mask-review"
        listing = client.get(base, headers=doctor).json()
        assert [c['voxels'] for c in listing['components']] == [144, 8] and listing['can_review']
        digest = listing['original_mask_sha256']
        saved = client.post(base, headers=doctor, json={'remove_components': [2], 'note': 'rib fragment', 'original_mask_sha256': digest})
        assert saved.status_code == 201
        record = saved.json()
        assert record['version'] == 1 and record['removed_voxels'] == 8 and record['remaining_voxels'] == 144
        assert record['original_mask_unchanged'] is True and path.read_bytes() == original
        edited = nib.load(STORAGE / 'volumes' / run / 'mask_review' / 'v1.nii.gz')
        assert int(np.asarray(edited.dataobj).sum()) == 144
        # a second version is computed from the model's original mask, not from version 1
        again = client.post(base, headers=doctor, json={'remove_components': [1], 'original_mask_sha256': digest}).json()
        assert again['version'] == 2 and again['remaining_voxels'] == 8
        assert client.get(base, headers=doctor).json()['current_version'] == 2
        download = client.get(base + '/versions/1/mask.nii.gz', headers=doctor)
        assert download.status_code == 200 and len(download.content) > 20
        mpr = f"/api/cases/{case['id']}/volumes/analyses/{run}/mpr.png?axis=2&index=3"
        assert client.get(mpr + '&mask_version=1', headers=doctor).status_code == 200
        assert client.get(mpr + '&mask_version=9', headers=doctor).status_code == 404


def test_mask_review_rejects_bad_edits_and_unauthorised_users():
    with TestClient(app) as client:
        _, doctor = make_user(f'mr-doc2-{uuid4().hex}@example.org', 'doctor')
        _, researcher = make_user(f'mr-res-{uuid4().hex}@example.org', 'researcher')
        case, run = _volume_run(client, doctor)
        _two_components(run)
        base = f"/api/cases/{case['id']}/volumes/analyses/{run}/mask-review"
        digest = client.get(base, headers=doctor).json()['original_mask_sha256']
        body = lambda **k: {'remove_components': [2], 'original_mask_sha256': digest, **k}
        assert client.post(base, headers=doctor, json=body(remove_components=[])).status_code == 422
        assert client.post(base, headers=doctor, json=body(remove_components=[9])).status_code == 422
        assert client.post(base, headers=doctor, json=body(remove_components=[1, 2])).status_code == 422
        assert client.post(base, headers=doctor, json=body(original_mask_sha256='0' * 64)).status_code == 409
        assert client.post(base, headers=researcher, json=body()).status_code in (403, 404)
        assert client.get(base, headers=researcher).status_code in (200, 404)
        assert not (STORAGE / 'volumes' / run / 'mask_review').exists() or not list((STORAGE / 'volumes' / run / 'mask_review').glob('v*.json'))


def test_painted_voxels_are_persisted_on_the_source_grid():
    with TestClient(app) as client:
        _, doctor = make_user(f'mr-paint-{uuid4().hex}@example.org', 'doctor')
        case, run = _volume_run(client, doctor)
        path = _two_components(run)
        original = path.read_bytes()
        base = f"/api/cases/{case['id']}/volumes/analyses/{run}/mask-review"
        digest = client.get(base, headers=doctor).json()['original_mask_sha256']
        data = {'original_mask_sha256': digest, 'voxel_edits': [
            {'ijk': [0, 0, 0], 'foreground': True},
            {'ijk': [2, 2, 2], 'foreground': False},
        ]}
        result = client.post(base, headers=doctor, json=data)
        assert result.status_code == 201
        record = result.json()
        assert record['added_voxels'] == record['removed_voxels'] == 1
        assert record['voxel_edits'] == data['voxel_edits']
        assert path.read_bytes() == original
        edited = nib.load(STORAGE / 'volumes' / run / 'mask_review' / 'v1.nii.gz')
        assert edited.dataobj[0, 0, 0] == 1 and edited.dataobj[2, 2, 2] == 0
        np.testing.assert_array_equal(edited.affine, nib.load(path).affine)
        data['voxel_edits'][0]['ijk'] = [-1, 0, 0]
        assert client.post(base, headers=doctor, json=data).status_code == 422
        assert client.get(base, headers=doctor).json()['current_version'] == 1
