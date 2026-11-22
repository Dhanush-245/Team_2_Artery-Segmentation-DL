"""Authenticated on-demand MPR rendering from one saved source/mask pair."""
from io import BytesIO

import nibabel as nib
import numpy as np
from PIL import Image


def render_mpr(source_path, mask_path, *, axis, index, window, level, opacity, physical_aspect=False):
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
