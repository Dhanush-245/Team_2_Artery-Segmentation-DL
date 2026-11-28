from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from test_rbac_system import make_user
from test_volume_xai import _volume_run


def test_locate_converts_between_world_and_voxel_and_is_protected():
    with TestClient(app) as client:
        _, owner = make_user(f'loc-owner-{uuid4().hex}@example.org', 'researcher')
        _, outsider = make_user(f'loc-out-{uuid4().hex}@example.org', 'researcher')
        case, run = _volume_run(client, owner)
        base = f"/api/cases/{case['id']}/volumes/analyses/{run}/locate"
        forward = client.get(base + '?i=3&j=5&k=2', headers=owner).json()
        assert forward['ijk'] == [3, 5, 2] and forward['inside_volume'] and forward['shape'] == [16, 16, 8]
        assert forward['axis_codes'] == ['R', 'A', 'S'] and forward['cardinal_axes'] is True
        back = client.get(base + '?' + '&'.join(f'{a}={v}' for a, v in zip('xyz', forward['ras_mm'])), headers=owner).json()
        assert back['ijk'] == [3, 5, 2]
        outside = client.get(base + '?i=99&j=0&k=0', headers=owner).json()
        assert outside['inside_volume'] is False and outside['ijk'][0] == 15
        assert client.get(base, headers=owner).status_code == 422
        assert client.get(base + '?i=1&j=1&k=1', headers=outsider).status_code == 404


def test_preview_carries_its_world_frame_so_a_crosshair_can_be_drawn(tmp_path):
    import nibabel as nib
    import numpy as np
    from app.volume_preview import mask_preview
    mask = np.zeros((12, 12, 12), np.uint8)
    mask[3:9, 3:9, 3:9] = 1
    image = nib.Nifti1Image(mask, np.diag([.5, .5, 1., 1.]))
    image.header.set_xyzt_units('mm')
    path = tmp_path / 'mask.nii.gz'
    nib.save(image, path)
    preview = mask_preview(path)
    centre, radius = preview['world_centre_mm'], preview['world_radius_mm']
    expected = nib.affines.apply_affine(image.affine, [5.5, 5.5, 5.5])
    assert np.allclose(centre, expected, atol=1e-3) and radius > 0
    middle = np.array(preview['mesh']['vertices']).mean(axis=0)
    assert np.allclose(middle, 0, atol=.2)
