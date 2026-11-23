"""CPR rendering and reviewer edits on a saved synthetic 3D run (tube with a narrowed middle)."""
import io
import json
from uuid import uuid4
from zipfile import ZipFile

import nibabel as nib
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import STORAGE, app
from test_rbac_system import make_user

SPACING = .5


def _narrowed_tube():
    """Tube along array axis 2: radius 2.5 mm, narrowed to 1.25 mm over 4 mm in the middle."""
    shape = (40, 40, 100)
    i, j, k = np.meshgrid(*[np.arange(n) for n in shape], indexing='ij')
    radial = np.hypot((i - 20) * SPACING, (j - 20) * SPACING)
    along = k * SPACING
    radius = np.where(np.abs(along - 25) < 2, 1.25, 2.5)
    mask = ((radial <= radius) & (along >= 5) & (along <= 45)).astype(np.uint8)
    return mask, mask.astype(np.int16) * 400


def _run(client, owner):
    from app.database import SessionLocal
    from app.models import VolumeAnalysis
    case = client.post('/api/cases', headers=owner, json={'case_code': 'GEO-' + uuid4().hex[:6], 'modality': 'CTA', 'anatomy': 'coronary'}).json()
    with SessionLocal() as db:
        row = VolumeAnalysis(case_id=case['id'], created_by=client.get('/api/auth/me', headers=owner).json()['id'], status='completed',
                             source_sha256='0' * 64, model_key='imagecas', input_kind='medical_study',
                             result_json=json.dumps({'checkpoint_sha256': 'x', 'model_id': 'imagecas-test', 'source_shape': [40, 40, 100]}))
        db.add(row); db.commit()
        run_id = row.id
    folder = STORAGE / 'volumes' / run_id
    (folder / 'outputs').mkdir(parents=True, exist_ok=True)
    mask, values = _narrowed_tube()
    for name, data in (('source.nii.gz', values), ('outputs/mask_source.nii.gz', mask)):
        image = nib.Nifti1Image(data, np.diag([SPACING, SPACING, SPACING, 1.]))
        image.header.set_xyzt_units('mm')
        nib.save(image, str(folder / name))
    return case, run_id


def test_cpr_and_reviewer_geometry_edits_are_authorized_computed_and_reported():
    with TestClient(app) as client:
        _, owner = make_user(f'geo-owner-{uuid4().hex}@example.org', 'researcher')
        doctor, doctor_headers = make_user(f'geo-doc-{uuid4().hex}@example.org', 'doctor')
        _, outsider = make_user(f'geo-out-{uuid4().hex}@example.org', 'doctor')
        case, run = _run(client, owner)
        base = f"/api/cases/{case['id']}/volumes/analyses/{run}"
        geometry = client.get(f'{base}/report/json', headers=owner).json()['experimental_geometry']
        path = max(geometry['paths'], key=lambda item: item['length_mm'])
        assert path['length_mm'] > 30

        cpr = client.get(f"{base}/cpr.png?path_id={path['id']}&rotation=45", headers=owner)
        assert cpr.status_code == 200 and cpr.headers['content-type'] == 'image/png'
        assert float(cpr.headers['x-cpr-length-mm']) == round(path['length_mm'], 3)
        assert client.get(f'{base}/cpr.png?path_id=P999', headers=owner).status_code == 404
        assert client.get(f"{base}/cpr.png?path_id={path['id']}", headers=outsider).status_code == 404
        assert client.get(f"{base}/cpr.png?path_id={path['id']}&window=0", headers=owner).status_code == 422

        listing = client.get(f'{base}/geometry-review', headers=owner).json()
        assert listing['current'] == [] and listing['can_review'] is False
        # The narrowing sits at arc length ~20 mm from the path start (tube starts at 5 mm).
        start_k = path['points_ras_mm'][0][2]
        minimum = abs(25 - start_k)
        body = dict(path_id=path['id'], mask_sha256=geometry['mask_sha256'], decision='accept', artery='LAD',
                    minimum_position_mm=minimum, reference_position_mm=minimum + 10, notes='mid narrowing')
        assert client.post(f'{base}/geometry-review', headers=owner, json=body).status_code == 403
        assert client.post(f'{base}/geometry-review', headers=doctor_headers, json=body).status_code == 404
        assert client.post(f"/api/cases/{case['id']}/access", headers=owner,
                           json={'user_email_or_id': doctor['email'], 'access_level': 'review'}).status_code == 201
        assert client.post(f'{base}/geometry-review', headers=doctor_headers, json={**body, 'mask_sha256': 'f' * 64}).status_code == 409
        assert client.post(f'{base}/geometry-review', headers=doctor_headers, json={**body, 'reference_position_mm': None}).status_code == 422
        assert client.post(f'{base}/geometry-review', headers=doctor_headers, json={**body, 'decision': 'reject'}).status_code == 422
        too_far = {**body, 'reference_position_mm': path['length_mm'] + 5}
        assert client.post(f'{base}/geometry-review', headers=doctor_headers, json=too_far).status_code == 422

        saved = client.post(f'{base}/geometry-review', headers=doctor_headers, json=body)
        assert saved.status_code == 201, saved.text
        measured = saved.json()['measurement']
        assert measured['diameter_method'] == 'perpendicular_section_area_equivalent_diameter'
        assert abs(measured['reference_diameter_mm'] - 5.0) < .8
        assert abs(measured['minimum_diameter_mm'] - 2.5) < .8
        assert 35 < measured['narrowing_percent'] < 65

        flagged = client.post(f'{base}/geometry-review', headers=doctor_headers,
                              json=dict(path_id=path['id'], mask_sha256=geometry['mask_sha256'], decision='uncertain'))
        assert flagged.status_code == 201
        listing = client.get(f'{base}/geometry-review', headers=owner).json()
        assert len(listing['history']) == 2 and listing['current'][0]['decision'] == 'uncertain'

        report = client.get(f'{base}/report/json', headers=owner).json()
        assert report['human_assessment']['edits_recorded'] == 2
        assert report['human_assessment']['current'][0]['decision'] == 'uncertain'
        assert 'review_path_id' in client.get(f'{base}/report/csv', headers=owner).text
        assert client.get(f'{base}/report/pdf', headers=owner).status_code == 200
        archive = ZipFile(io.BytesIO(client.get(f'{base}/evidence.zip', headers=owner).content))
        assert len(json.loads(archive.read('geometry_review.json'))) == 2
        assert 'interactive_cpr' not in json.loads(archive.read('manifest.json'))['unavailable']


@pytest.mark.parametrize("role", ["clinician", "admin"])
def test_cpr_permissions_distinguish_read_and_review_grants(role):
    with TestClient(app) as client:
        _, owner = make_user(f"geo-owner-{uuid4().hex}@example.org", "researcher")
        reviewer, headers = make_user(f"geo-reviewer-{uuid4().hex}@example.org", role)
        case, run = _run(client, owner)
        base = f"/api/cases/{case['id']}/volumes/analyses/{run}"
        access = f"/api/cases/{case['id']}/access"
        geometry = client.get(f"{base}/report/json", headers=owner).json()["experimental_geometry"]
        path = geometry["paths"][0]["id"]
        urls = (f"{base}/cpr.png?path_id={path}", f"{base}/geometry-review")
        body = dict(path_id=path, mask_sha256=geometry["mask_sha256"], decision="uncertain")

        for url in urls:
            assert client.get(url, headers=headers).status_code == 404
        assert client.post(urls[1], headers=headers, json=body).status_code == 404
        for level, can_review in [("read", False), ("review", True), ("read", False)]:
            assert client.post(access, headers=owner, json={
                "user_email_or_id": reviewer["email"], "access_level": level,
            }).status_code == 201
            assert client.get(urls[0], headers=headers).status_code == 200
            listing = client.get(urls[1], headers=headers)
            assert listing.status_code == 200
            assert listing.json()["can_review"] is can_review
            saved = client.post(urls[1], headers=headers, json=body)
            assert saved.status_code == (201 if can_review else 403)
            if can_review:
                assert saved.json()["reviewer_role"] == role
        assert len(listing.json()["history"]) == 1
