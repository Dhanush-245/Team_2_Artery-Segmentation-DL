"""Authenticated on-demand MPR rendering from one saved source/mask pair."""
from io import BytesIO

import nibabel as nib
import numpy as np
from PIL import Image


def slice_from_coarse(coarse, coarse_affine, source, axis, index, cropped=False):
    """Trilinearly sample a coarse array on one native slice through the affines (as resample_from_to, order=1)."""
    from scipy.ndimage import map_coordinates
    shape = [n for i, n in enumerate(source.shape[:3]) if i != axis]
    grid = np.meshgrid(np.arange(shape[0]), np.arange(shape[1]), indexing='ij')
    voxels = [None, None, None]
    others = [i for i in range(3) if i != axis]
    voxels[axis] = np.full(grid[0].shape, index, dtype=float)
    voxels[others[0]], voxels[others[1]] = grid[0].astype(float), grid[1].astype(float)
    points = np.stack([v.ravel() for v in voxels] + [np.ones(grid[0].size)])
    coarse_voxels = (np.linalg.inv(coarse_affine) @ source.affine @ points)[:3]
    sampled = map_coordinates(np.asarray(coarse, dtype=np.float32), coarse_voxels, order=1, mode='constant' if cropped else 'nearest', cval=0)
    return np.clip(sampled.reshape(grid[0].shape), 0, 1)


def render_mpr(source_path, mask_path, *, axis, index, window, level, opacity, physical_aspect=False,
               heat=None, heat_opacity=0.7):
    if axis not in (0, 1, 2) or not np.isfinite([window, level, opacity]).all():
        raise ValueError('Invalid MPR controls')
    if window <= 0 or not 0 <= opacity <= 1:
        raise ValueError('Window must be positive and opacity must be within 0..1')
    source, mask_image = nib.load(source_path), nib.load(mask_path)
    if source.shape != mask_image.shape or not np.allclose(source.affine, mask_image.affine, atol=1e-5):
        raise ValueError('Source and mask geometry differ')
    if not 0 <= index < source.shape[axis]:
        raise ValueError('MPR index is outside the source volume')
    values = np.asarray(np.take(np.asarray(source.dataobj), index, axis=axis), dtype=np.float32)
    selected = np.asarray(np.take(np.asarray(mask_image.dataobj), index, axis=axis)) > 0
    if not np.isfinite(values).all():
        raise ValueError('Source slice contains non-finite intensities')
    gray = np.uint8(np.clip((values - (level-window/2)) / window, 0, 1) * 255)
    gray = gray.T[::-1]
    selected = selected.T[::-1]
    rgb = np.repeat(gray[..., None], 3, axis=2).astype(np.float32)
    color = np.array([0, 205, 220], dtype=np.float32)
    rgb[selected] = rgb[selected] * (1-opacity) + color * opacity
    if heat is not None:
        if not 0 <= heat_opacity <= 1:
            raise ValueError('Attribution opacity must be within 0..1')
        values = slice_from_coarse(heat[0], heat[1], source, axis, index, cropped=heat[2] if len(heat) > 2 else False).T[::-1]
        ramp = np.stack((np.minimum(1, values * 2), np.clip(values * 2 - .65, 0, 1), np.clip(values * 3 - 2, 0, 1)), -1) * 255
        alpha = (np.clip(values * 1.4, 0, 1) * heat_opacity)[..., None]
        rgb = rgb * (1 - alpha) + ramp * alpha
    picture = Image.fromarray(np.uint8(np.clip(rgb, 0, 255)))
    if physical_aspect:
        # Rows follow the second remaining array axis and columns the first, after the transpose above.
        column_axis, row_axis = [item for item in range(3) if item != axis]
        zooms = [float(z) for z in source.header.get_zooms()[:3]]
        if zooms[column_axis] > 0 and zooms[row_axis] > 0:
            height = max(1, round(picture.height * zooms[row_axis] / zooms[column_axis]))
            if height != picture.height:
                picture = picture.resize((picture.width, height), Image.Resampling.BILINEAR)
    stream = BytesIO()
    picture.save(stream, format='PNG')
    return stream.getvalue()
