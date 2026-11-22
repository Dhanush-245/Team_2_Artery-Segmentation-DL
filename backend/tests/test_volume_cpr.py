from io import BytesIO

import nibabel as nib
import numpy as np
import pytest
from PIL import Image

from app.volume_cpr import render_cpr, straighten

SPACING = .5


def _tube(points_mm, radius_mm, shape=(80, 80, 80)):
    """Binary tube around a polyline, with a contrast-like intensity (400 HU inside, 0 outside)."""
    grid = np.stack(np.meshgrid(*[np.arange(n) * SPACING for n in shape], indexing='ij'), -1)
    dense = np.concatenate([np.linspace(a, b, 40, endpoint=False) for a, b in zip(points_mm[:-1], points_mm[1:])] + [points_mm[-1:]])
    distance = np.full(shape, np.inf)
    for point in dense:
        distance = np.minimum(distance, np.linalg.norm(grid - point, axis=-1))
    mask = (distance <= radius_mm).astype(np.uint8)
    return mask, mask.astype(np.int16) * 400, np.diag([SPACING, SPACING, SPACING, 1.])


def _band_widths(mask_rows, step_mm):
    """Width (mm) of the mask run that crosses the centre column of each straightened row."""
    centre = mask_rows.shape[1] // 2
    widths = []
    for row in mask_rows:
        if not row[centre]:
            widths.append(0.)
            continue
        left = right = centre
        while left > 0 and row[left - 1]:
            left -= 1
        while right < len(row) - 1 and row[right + 1]:
            right += 1
        widths.append((right - left + 1) * step_mm)
    return np.array(widths)


def test_straight_tube_becomes_constant_band_of_its_diameter():
    path = np.array([[20., 20., 5.], [20., 20., 35.]])
    mask, values, affine = _tube(path, 3.)
    result = straighten(values, mask, affine, path, half_width_mm=8, step_mm=.25)
    assert result['intensity'].shape == result['mask'].shape
    assert abs(result['length_mm'] - 30.) < 1e-6
    assert result['mask'].shape[0] == round(30 / .25) + 1
    widths = _band_widths(result['mask'][8:-8], .25)
    assert np.all(np.abs(widths - 6.) <= 1.)
    assert result['intensity'][len(result['intensity']) // 2, result['intensity'].shape[1] // 2] == pytest.approx(400, abs=1)


def test_curved_tube_is_straightened_at_constant_width_and_rotation_invariant():
    angles = np.linspace(0, np.pi / 2, 30)
    path = np.stack([5 + 25 * np.cos(angles), 5 + 25 * np.sin(angles), np.full_like(angles, 20.)], -1)
    mask, values, affine = _tube(path, 2.5)
    expected_length = 25 * np.pi / 2
    for rotation in (0, 90):
        result = straighten(values, mask, affine, path, half_width_mm=7, step_mm=.25, rotation_deg=rotation)
        assert abs(result['length_mm'] - expected_length) / expected_length < .01
        widths = _band_widths(result['mask'][10:-10], .25)
        assert np.all(widths > 0), 'the centreline must stay inside the lumen on every row'
        assert abs(np.median(widths) - 5.) <= 1.


def test_render_cpr_png_overlays_mask_and_validates_controls(tmp_path):
    path = np.array([[20., 20., 5.], [20., 20., 35.]])
    mask, values, affine = _tube(path, 3.)
    source_path, mask_path = tmp_path / 's.nii.gz', tmp_path / 'm.nii.gz'
    nib.save(nib.Nifti1Image(values, affine), source_path)
    nib.save(nib.Nifti1Image(mask, affine), mask_path)
    payload = render_cpr(source_path, mask_path, path.tolist(), window=800, level=300, opacity=.5)
    image = np.asarray(Image.open(BytesIO(payload)))
    assert image.ndim == 3 and image.shape[1] > image.shape[0], 'x runs along the path'
    centre = image[image.shape[0] // 2, image.shape[1] // 2]
    assert centre[1] != centre[0], 'mask overlay is coloured'
    with pytest.raises(ValueError, match='two'):
        render_cpr(source_path, mask_path, [[1., 1., 1.]], window=800, level=300, opacity=.5)
    with pytest.raises(ValueError, match='Window'):
        render_cpr(source_path, mask_path, path.tolist(), window=0, level=300, opacity=.5)
    with pytest.raises(ValueError, match='finite'):
        render_cpr(source_path, mask_path, [[1., 1., np.nan], [2., 2., 2.]], window=800, level=300, opacity=.5)
