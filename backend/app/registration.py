"""2D image registration: align one prepared angiography frame to another frame of the same case.

Intended for frames of the same projection (repeat acquisition, different time point or frame of a series), where
the difference is a shift, a small rotation or a small scale change. Different projection angles cannot be aligned
by a 2D transform and are reported as not aligned instead of forced.

Registration is computed on the prepared model-input previews, which share one grid, and is for visual comparison
only. It never changes stored images, masks, measurements or reports.
"""
import math

import cv2
import numpy as np
from fastapi import Depends, HTTPException, Query
from fastapi.responses import Response

MODES = {'rigid': cv2.MOTION_EUCLIDEAN, 'affine': cv2.MOTION_AFFINE}
MIN_IMPROVEMENT = 0.02      # normalized cross-correlation must improve by at least this
LOW_CONFIDENCE_NCC = 0.6    # below this, an aligned result is flagged as low confidence
MAX_SIDE = 2048


def to_gray(image: np.ndarray) -> np.ndarray:
    if image.ndim == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY if image.shape[2] == 3 else cv2.COLOR_BGRA2GRAY)
    return image.astype(np.uint8) if image.dtype != np.uint8 else image


def ncc(reference: np.ndarray, other: np.ndarray, mask: np.ndarray | None = None) -> float:
    """Normalized cross-correlation over the valid area (1.0 means identical up to brightness and contrast)."""
    a, b = reference.astype(np.float64), other.astype(np.float64)
    if mask is not None:
        a, b = a[mask], b[mask]
    else:
        a, b = a.ravel(), b.ravel()
    if a.size < 100:
        return 0.0
    a, b = a - a.mean(), b - b.mean()
    denominator = math.sqrt(float((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / denominator) if denominator > 0 else 0.0


def _warp(moving: np.ndarray, matrix: np.ndarray, shape) -> tuple[np.ndarray, np.ndarray]:
    """Apply a reference-to-moving matrix (ECC convention); returns the aligned image and its valid-pixel mask."""
    h, w = shape
    flags = cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP
    aligned = cv2.warpAffine(moving, matrix, (w, h), flags=flags, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    valid = cv2.warpAffine(np.full(moving.shape, 255, np.uint8), matrix, (w, h), flags=flags, borderMode=cv2.BORDER_CONSTANT, borderValue=0) > 250
    return aligned, valid


def _ecc(reference: np.ndarray, moving: np.ndarray, motion: int) -> np.ndarray | None:
    """Multi-resolution ECC. Returns the reference-to-moving 2x3 matrix or None when it does not converge."""
    matrix = np.eye(2, 3, dtype=np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-5)
    for scale in (4, 2, 1):
        ref_s = cv2.resize(reference, None, fx=1 / scale, fy=1 / scale, interpolation=cv2.INTER_AREA) if scale > 1 else reference
        mov_s = cv2.resize(moving, None, fx=1 / scale, fy=1 / scale, interpolation=cv2.INTER_AREA) if scale > 1 else moving
        level = matrix.copy()
        level[:, 2] /= scale
        try:
            _, level = cv2.findTransformECC(ref_s, mov_s, level, motion, criteria, None, 5)
        except cv2.error:
            return None
        matrix = level.copy()
        matrix[:, 2] *= scale
    return matrix


def _phase_shift(reference: np.ndarray, moving: np.ndarray) -> np.ndarray:
    window = cv2.createHanningWindow((reference.shape[1], reference.shape[0]), cv2.CV_32F)
    (dx, dy), _ = cv2.phaseCorrelate(reference.astype(np.float32), moving.astype(np.float32), window)
    matrix = np.eye(2, 3, dtype=np.float32)
    matrix[0, 2], matrix[1, 2] = -dx, -dy  # reference-to-moving
    return matrix


def parameters(reference_to_moving: np.ndarray) -> dict:
    """Readable transform parameters that bring the moving frame onto the reference (inverse of the ECC matrix).

    Translation is in prepared-image pixels (x right, y down). Rotation is in degrees, positive when the moving frame
    must be turned counter-clockwise, as it appears on screen, to line up with the reference.
    """
    m = cv2.invertAffineTransform(reference_to_moving.astype(np.float64))
    linear = m[:, :2]
    sx, sy = math.hypot(linear[0, 0], linear[1, 0]), math.hypot(linear[0, 1], linear[1, 1])
    return {'translation_x_px': round(float(m[0, 2]), 2), 'translation_y_px': round(float(m[1, 2]), 2),
            'rotation_deg': round(-math.degrees(math.atan2(linear[1, 0], linear[0, 0])), 3),
            'scale_x': round(sx, 4), 'scale_y': round(sy, 4)}


def register(reference: np.ndarray, moving: np.ndarray, mode: str = 'rigid') -> dict:
    """Align `moving` to `reference`. Always returns a result; `success` says whether alignment is trustworthy."""
    if mode not in MODES:
        raise ValueError('mode must be rigid or affine')
    ref, mov = to_gray(reference), to_gray(moving)
    if max(ref.shape) > MAX_SIDE or max(mov.shape) > MAX_SIDE:
        raise ValueError('images are too large for registration')
    resized = mov.shape != ref.shape
    if resized:
        mov = cv2.resize(mov, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_AREA)
    ref_f, mov_f = cv2.GaussianBlur(ref, (5, 5), 0), cv2.GaussianBlur(mov, (5, 5), 0)
    identity = np.eye(2, 3, dtype=np.float32)
    ncc_before = ncc(ref_f, mov_f)
    candidates = [('ecc', _ecc(ref_f, mov_f, MODES[mode])), ('phase_correlation', _phase_shift(ref_f, mov_f))]
    best = {'method': 'identity', 'matrix': identity, 'ncc': ncc_before}
    for method, matrix in candidates:
        if matrix is None or not np.all(np.isfinite(matrix)):
            continue
        aligned, valid = _warp(mov_f, matrix, ref.shape)
        score = ncc(ref_f, aligned, valid)
        if score > best['ncc']:
            best = {'method': method, 'matrix': matrix, 'ncc': score}
    improvement = best['ncc'] - ncc_before
    success = best['method'] != 'identity' and improvement >= MIN_IMPROVEMENT
    matrix = best['matrix'] if success else identity
    reason = None
    if not success:
        reason = ('The frames are already aligned' if ncc_before >= 0.95
                  else 'No 2D shift, rotation or scale change makes these frames agree better; they may show different projections')
    return {'mode': mode, 'success': bool(success), 'reason': reason, 'method': best['method'] if success else 'none',
            'ncc_before': round(ncc_before, 4), 'ncc_after': round(best['ncc'] if success else ncc_before, 4),
            'improvement': round(improvement if success else 0.0, 4),
            'low_confidence': bool(success and best['ncc'] < LOW_CONFIDENCE_NCC),
            'parameters': parameters(matrix), 'matrix_reference_to_moving': [[round(float(v), 6) for v in row] for row in matrix],
            'moving_resized_to_reference': bool(resized), 'grid': {'width': int(ref.shape[1]), 'height': int(ref.shape[0])}}


def render(reference: np.ndarray, moving: np.ndarray, result: dict, view: str = 'blend') -> bytes:
    """PNG overlay of the reference and the aligned frame. `blend`: reference red, aligned green; agreement looks yellow."""
    ref, mov = to_gray(reference), to_gray(moving)
    if mov.shape != ref.shape:
        mov = cv2.resize(mov, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_AREA)
    matrix = np.array(result['matrix_reference_to_moving'], dtype=np.float32)
    aligned, _ = _warp(mov, matrix, ref.shape)
    if view == 'aligned':
        out = cv2.cvtColor(aligned, cv2.COLOR_GRAY2BGR)
    elif view == 'checker':
        h, w = ref.shape
        tile = max(16, min(h, w) // 16)
        grid = ((np.arange(h)[:, None] // tile + np.arange(w)[None, :] // tile) % 2).astype(bool)
        out = cv2.cvtColor(np.where(grid, ref, aligned).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    else:
        out = np.dstack([np.zeros_like(ref), aligned, ref])  # BGR: green = aligned frame, red = reference
    ok, buffer = cv2.imencode('.png', out)
    if not ok:
        raise ValueError('overlay could not be encoded')
    return buffer.tobytes()


def _load(path) -> np.ndarray:
    data = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if data is None:
        raise HTTPException(404, 'Prepared image is not available')
    return data


def install(app, *, get_db, current_user, accessible_case, Image):
    """Routes: JSON result and PNG overlay for two images of one case. Read-only; nothing is stored."""

    def pair(image_id, reference_id, user, db):
        if image_id == reference_id:
            raise HTTPException(422, 'Choose a different image as the reference')
        images = []
        for identifier in (image_id, reference_id):
            image = db.get(Image, identifier)
            if image is None:
                raise HTTPException(404, 'Image not found')
            accessible_case(image.case_id, user, db, required_action='read')
            images.append(image)
        if images[0].case_id != images[1].case_id:
            raise HTTPException(422, 'Registration compares two images of the same case')
        return images

    @app.get('/api/images/{image_id}/registration')
    def image_registration(image_id: str, reference_id: str, mode: str = Query('rigid'),
                           user=Depends(current_user), db=Depends(get_db)):
        moving_image, reference_image = pair(image_id, reference_id, user, db)
        try:
            result = register(_load(reference_image.preview_path), _load(moving_image.preview_path), mode)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        base = f'/api/images/{image_id}/registration/overlay.png?reference_id={reference_id}&mode={mode}'
        return {'image_id': image_id, 'reference_id': reference_id, **result,
                'overlay_urls': {view: f'{base}&view={view}' for view in ('blend', 'checker', 'aligned')},
                'note': 'Computed on the prepared previews for visual comparison. Stored images, masks, measurements and reports are not changed.'}

    @app.get('/api/images/{image_id}/registration/overlay.png')
    def image_registration_overlay(image_id: str, reference_id: str, mode: str = Query('rigid'),
                                   view: str = Query('blend', pattern='^(blend|checker|aligned)$'),
                                   user=Depends(current_user), db=Depends(get_db)):
        moving_image, reference_image = pair(image_id, reference_id, user, db)
        reference, moving = _load(reference_image.preview_path), _load(moving_image.preview_path)
        try:
            result = register(reference, moving, mode)
            payload = render(reference, moving, result, view)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        return Response(payload, media_type='image/png', headers={'Cache-Control': 'no-store', 'X-Registration-Success': str(result['success']).lower()})
