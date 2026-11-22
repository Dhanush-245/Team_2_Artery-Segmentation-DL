"""Straightened curved planar reformation (CPR) along one saved centreline path.

``straighten`` returns arrays whose rows follow the path at equal arc-length steps and whose columns
run across the vessel along a rotation-minimising normal, rotated about the tangent by ``rotation_deg``.
The rendered PNG is transposed for display: x runs along the path (left = first path point) and y
across it. Both axes use the same physical step, so the image has true proportions. Research only.
"""
from io import BytesIO

import nibabel as nib
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

MAX_ROWS = 4000
MAX_HALF_WIDTH_MM = 30
TANGENT_HALF_SPAN_MM = 1.0
MASK_COLOR = np.array([0, 205, 220], dtype=np.float32)


def _validated_points(points):
    path = np.asarray(points, dtype=float)
    if path.ndim != 2 or path.shape[1] != 3 or len(path) < 2:
        raise ValueError('A CPR path needs at least two 3D points')
    if not np.isfinite(path).all():
        raise ValueError('CPR path points must be finite')
    return path


def _resample(path, step_mm):
    """Equal arc-length samples along the polyline (duplicate points removed)."""
    keep = np.r_[True, np.linalg.norm(np.diff(path, axis=0), axis=1) > 1e-9]
    path = path[keep]
    if len(path) < 2:
        raise ValueError('A CPR path needs at least two distinct points')
    cumulative = np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]
    length = float(cumulative[-1])
    rows = int(round(length / step_mm)) + 1
    if rows > MAX_ROWS:
        raise ValueError('CPR path is too long for the requested sampling step')
    positions = np.linspace(0, length, max(rows, 2))
    centre = np.stack([np.interp(positions, cumulative, path[:, axis]) for axis in range(3)], -1)
    return centre, positions, length


def _tangents(centre, positions):
    span = max(TANGENT_HALF_SPAN_MM, positions[1] - positions[0])
    ahead = np.stack([np.interp(np.minimum(positions + span, positions[-1]), positions, centre[:, a]) for a in range(3)], -1)
    behind = np.stack([np.interp(np.maximum(positions - span, 0), positions, centre[:, a]) for a in range(3)], -1)
    tangents = ahead - behind
    return tangents / np.linalg.norm(tangents, axis=1, keepdims=True)


def _normals(tangents, rotation_deg):
    """Rotation-minimising (parallel-transported) normals, then a fixed roll about the tangent."""
    seed = np.eye(3)[np.argmin(np.abs(tangents[0]))]
    normal = np.cross(tangents[0], seed)
    normals = []
    for tangent in tangents:
        normal = normal - (normal @ tangent) * tangent
        normal /= np.linalg.norm(normal)
        normals.append(normal)
    normals = np.array(normals)
    angle = np.deg2rad(rotation_deg)
    return np.cos(angle) * normals + np.sin(angle) * np.cross(tangents, normals)


def sample_grid(points, *, half_width_mm=10., step_mm=.3, rotation_deg=0.):
    """World (RAS mm) coordinates of every CPR pixel, shape (rows, columns, 3)."""
    if not 0 < step_mm <= 2 or not 0 < half_width_mm <= MAX_HALF_WIDTH_MM:
        raise ValueError('CPR step must be within 0..2 mm and half-width within 0..30 mm')
    if not np.isfinite(rotation_deg):
        raise ValueError('CPR rotation must be finite')
    centre, positions, length = _resample(_validated_points(points), step_mm)
    normals = _normals(_tangents(centre, positions), rotation_deg)
    offsets = np.linspace(-half_width_mm, half_width_mm, 2 * int(round(half_width_mm / step_mm)) + 1)
    return centre[:, None, :] + offsets[None, :, None] * normals[:, None, :], length


def _sample(values, mask, affine, world):
    voxels = nib.affines.apply_affine(np.linalg.inv(affine), world.reshape(-1, 3)).T
    intensity = map_coordinates(np.asarray(values, dtype=np.float32), voxels, order=1, mode='constant',
                                cval=float(np.min(values)) if np.size(values) else 0.)
    labels = map_coordinates(np.asarray(mask, dtype=np.uint8), voxels, order=0, mode='constant', cval=0)
    return intensity.reshape(world.shape[:2]), labels.reshape(world.shape[:2]) > 0


def straighten(values, mask, affine, points, *, half_width_mm=10., step_mm=.3, rotation_deg=0.):
    world, length = sample_grid(points, half_width_mm=half_width_mm, step_mm=step_mm, rotation_deg=rotation_deg)
    intensity, labels = _sample(values, mask, affine, world)
    return dict(intensity=intensity, mask=labels, length_mm=length, step_mm=step_mm,
                half_width_mm=half_width_mm, rotation_deg=rotation_deg)


def _crop(image, world):
    """Load only the voxel box the CPR samples touch (plus a 2-voxel margin), with its affine."""
    voxels = nib.affines.apply_affine(np.linalg.inv(image.affine), world.reshape(-1, 3))
    low = np.maximum(np.floor(voxels.min(0)).astype(int) - 2, 0)
    high = np.minimum(np.ceil(voxels.max(0)).astype(int) + 3, np.array(image.shape[:3]))
    if np.any(high <= low):
        raise ValueError('CPR path lies outside the saved volume')
    box = tuple(slice(int(a), int(b)) for a, b in zip(low, high))
    shifted = image.affine.copy()
    shifted[:3, 3] = nib.affines.apply_affine(image.affine, low)
    return np.asarray(image.dataobj[box]), shifted


def render_cpr(source_path, mask_path, points, *, window, level, opacity, rotation_deg=0.,
               half_width_mm=10., step_mm=.3):
    if not np.isfinite([window, level, opacity]).all() or window <= 0:
        raise ValueError('Window must be positive and finite')
    if not 0 <= opacity <= 1:
        raise ValueError('Mask opacity must be within 0..1')
    world, length = sample_grid(points, half_width_mm=half_width_mm, step_mm=step_mm, rotation_deg=rotation_deg)
    source, mask_image = nib.load(source_path), nib.load(mask_path)
    if source.shape != mask_image.shape or not np.allclose(source.affine, mask_image.affine, atol=1e-5):
        raise ValueError('Source and mask geometry differ')
    values, affine = _crop(source, world)
    labels, _ = _crop(mask_image, world)
    intensity, selected = _sample(values, labels, affine, world)
    if not np.isfinite(intensity).all():
        raise ValueError('Source volume contains non-finite intensities along the path')
    gray = np.clip((intensity - (level - window / 2)) / window, 0, 1) * 255
    rgb = np.repeat(gray[..., None], 3, axis=2)
    rgb[selected] = rgb[selected] * (1 - opacity) + MASK_COLOR * opacity
    stream = BytesIO()
    Image.fromarray(np.uint8(np.clip(rgb, 0, 255)).transpose(1, 0, 2)).save(stream, format='PNG')
    return stream.getvalue()
