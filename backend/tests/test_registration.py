"""2D registration of two prepared frames of one case (module 3: image registration)."""
from io import BytesIO
from uuid import uuid4

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app import registration
from app.main import app
from test_rbac_system import make_user


def _frame(seed=1, size=512):
    """Vessel-like synthetic frame: noisy background with a few thick curved vessels and a branch."""
    rng = np.random.default_rng(seed)
    image = (150 + rng.normal(0, 6, (size, size))).astype(np.float32)
    for _ in range(5):
        points = np.cumsum(rng.integers(-60, 90, size=(7, 2)), axis=0) + rng.integers(40, size - 40, size=(1, 2))
        points = np.clip(points, 10, size - 10).astype(np.int32)
        cv2.polylines(image, [points.reshape(-1, 1, 2)], False, float(rng.integers(30, 70)), int(rng.integers(5, 12)))
    return np.clip(cv2.GaussianBlur(image, (7, 7), 0), 0, 255).astype(np.uint8)


def _transform(image, tx=0., ty=0., degrees=0., scale=1.):
    h, w = image.shape
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, scale)
    matrix[:, 2] += (tx, ty)
    return cv2.warpAffine(image, matrix, (w, h), borderMode=cv2.BORDER_REFLECT)


def test_a_shifted_and_rotated_frame_is_recovered_in_rigid_mode():
    reference = _frame()
    moving = _transform(reference, tx=9, ty=-6, degrees=3.0)
    result = registration.register(reference, moving, 'rigid')
    assert result['success'] and result['method'] in {'ecc', 'phase_correlation'}
    assert result['ncc_after'] > 0.9 and result['improvement'] > 0.2 and not result['low_confidence']
    parameters = result['parameters']
    assert abs(parameters['rotation_deg'] + 3.0) < 0.6          # counter-clockwise positive: undoing a +3 degree turn is -3
    assert abs(parameters['scale_x'] - 1) < 0.02 and abs(parameters['scale_y'] - 1) < 0.02


def test_a_pure_shift_is_recovered_to_a_pixel():
    reference = _frame(seed=2)
    result = registration.register(reference, _transform(reference, tx=12, ty=-8), 'rigid')
    assert result['success']
    assert abs(result['parameters']['translation_x_px'] + 12) < 1.5 and abs(result['parameters']['translation_y_px'] - 8) < 1.5


def test_a_small_scale_change_needs_and_gets_affine_mode():
    reference = _frame(seed=3)
    moving = _transform(reference, tx=5, ty=4, scale=1.05)
    rigid = registration.register(reference, moving, 'rigid')
    affine = registration.register(reference, moving, 'affine')
    assert affine['success'] and affine['ncc_after'] >= rigid['ncc_after'] - 0.01
    assert abs(affine['parameters']['scale_x'] - 1 / 1.05) < 0.02


def test_identical_and_unrelated_frames_are_not_forced_into_alignment():
    reference = _frame(seed=4)
    same = registration.register(reference, reference.copy(), 'rigid')
    assert not same['success'] and 'already aligned' in same['reason']
    assert same['parameters']['translation_x_px'] == 0 and same['parameters']['rotation_deg'] == 0
    other = registration.register(reference, _frame(seed=99), 'rigid')
    assert not other['success'] and other['reason']
    assert other['matrix_reference_to_moving'] == [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
    assert other['ncc_after'] == other['ncc_before']


def test_overlay_views_are_valid_pngs_of_the_reference_size_and_bad_input_is_rejected():
    reference = _frame(seed=5)
    moving = _transform(reference, tx=6, ty=3)
    result = registration.register(reference, moving, 'rigid')
    for view in ('blend', 'checker', 'aligned'):
        data = registration.render(reference, moving, result, view)
        decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        assert decoded.shape == (512, 512, 3), view
    blend = cv2.imdecode(np.frombuffer(registration.render(reference, moving, result, 'blend'), np.uint8), cv2.IMREAD_COLOR)
    assert blend[:, :, 0].max() == 0  # blue channel unused: red = reference, green = aligned frame
    try:
        registration.register(reference, moving, 'perspective')
        raise AssertionError('unknown mode accepted')
    except ValueError:
        pass
    smaller = cv2.resize(moving, (300, 300))
    assert registration.register(reference, smaller, 'rigid')['moving_resized_to_reference'] is True


def _png(image):
    ok, buffer = cv2.imencode('.png', image)
    assert ok
    return buffer.tobytes()


def _case_with_two_frames(client, headers, moving_kwargs=None):
    case = client.post('/api/cases', headers=headers, json={'case_code': 'REG-' + uuid4().hex[:6], 'modality': 'XCA', 'anatomy': 'coronary'}).json()
    reference = _frame(seed=7)
    moving = _transform(reference, **(moving_kwargs or {'tx': 8, 'ty': -5, 'degrees': 2.0}))
    ids = []
    for image in (reference, moving):
        response = client.post(f"/api/cases/{case['id']}/images", headers=headers, files={'file': ('f.png', _png(image), 'image/png')}, data={'modality': 'XCA'})
        assert response.status_code == 201, response.text
        ids.append(response.json()['id'])
    return case, ids[0], ids[1]


def test_api_aligns_two_frames_of_a_case_and_serves_the_overlay():
    with TestClient(app) as client:
        _, owner = make_user(f'reg-owner-{uuid4().hex}@example.org', 'researcher')
        case, reference_id, moving_id = _case_with_two_frames(client, owner)
        body = client.get(f'/api/images/{moving_id}/registration?reference_id={reference_id}', headers=owner).json()
        assert body['success'] and body['ncc_after'] > body['ncc_before'] + 0.1
        assert set(body['overlay_urls']) == {'blend', 'checker', 'aligned'} and 'not changed' in body['note']
        overlay = client.get(body['overlay_urls']['blend'], headers=owner)
        assert overlay.status_code == 200 and overlay.headers['content-type'] == 'image/png'
        assert overlay.headers['x-registration-success'] == 'true' and overlay.content[:4] == b'\x89PNG'
        assert client.get(f'/api/images/{moving_id}/registration?reference_id={reference_id}&mode=bogus', headers=owner).status_code == 422
        assert client.get(f'/api/images/{moving_id}/registration/overlay.png?reference_id={reference_id}&view=nope', headers=owner).status_code == 422


def test_registration_follows_case_access_and_stays_within_one_case():
    with TestClient(app) as client:
        _, owner = make_user(f'reg-own2-{uuid4().hex}@example.org', 'researcher')
        viewer_user, viewer = make_user(f'reg-view-{uuid4().hex}@example.org', 'viewer')
        _, outsider = make_user(f'reg-out-{uuid4().hex}@example.org', 'researcher')
        case, reference_id, moving_id = _case_with_two_frames(client, owner)
        url = f'/api/images/{moving_id}/registration?reference_id={reference_id}'
        assert client.get(url).status_code == 401
        assert client.get(url, headers=outsider).status_code == 404
        assert client.get(url, headers=viewer).status_code == 404
        assert client.post(f"/api/cases/{case['id']}/access", headers=owner, json={'user_email_or_id': viewer_user['email'], 'access_level': 'read'}).status_code == 201
        assert client.get(url, headers=viewer).status_code == 200
        assert client.get(f'/api/images/{moving_id}/registration?reference_id={moving_id}', headers=owner).status_code == 422
        _, other_reference, _ = _case_with_two_frames(client, owner)
        assert client.get(f'/api/images/{moving_id}/registration?reference_id={other_reference}', headers=owner).status_code == 422
