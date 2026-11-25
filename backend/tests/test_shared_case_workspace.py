"""Shared deployment workspace: visibility is shared; role capabilities are not."""
from io import BytesIO

from PIL import Image
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import User
from app.security import hash_password

ROLES = ('admin', 'doctor', 'clinician', 'researcher', 'technician', 'viewer', 'ml_engineer')


def login(client, role, suffix=''):
    email = f'shared-{role}{suffix}@test.org'
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if not user:
            db.add(User(email=email, password_hash=hash_password('shared-test-pass-123'), role=role, status='active'))
            db.commit()
    response = client.post('/api/auth/login', json={'email': email, 'password': 'shared-test-pass-123'})
    assert response.status_code == 200, response.text
    return {'Authorization': f'Bearer {response.json()["access_token"]}'}


def test_shared_upload_visibility_notifications_and_role_actions(monkeypatch):
    monkeypatch.setenv('CV_CASE_VISIBILITY', 'shared')
    with TestClient(app) as c:
        headers = {role: login(c, role) for role in ROLES}
        created = []
        for creator in ('researcher', 'clinician', 'doctor'):
            response = c.post('/api/cases', headers=headers[creator], json={'case_code': f'SHARED-{creator}'})
            assert response.status_code == 201, response.text
            cid = response.json()['id']
            created.append(cid)
            data = BytesIO()
            Image.new('L', (64, 64), 120).save(data, format='PNG')
            upload = c.post(f'/api/cases/{cid}/images', headers=headers[creator],
                            files={'file': ('deidentified.png', data.getvalue(), 'image/png')})
            assert upload.status_code == 201, upload.text
            for role in ROLES:
                detail = c.get(f'/api/cases/{cid}', headers=headers[role])
                if role == 'ml_engineer':
                    assert detail.status_code == 403
                    assert all(n['case_id'] != cid for n in c.get('/api/notifications', headers=headers[role]).json())
                    continue
                assert detail.status_code == 200, (role, detail.text)
                case = detail.json()
                assert case['images'] and case['visibility'] == 'shared'
                assert cid in {row['id'] for row in c.get('/api/cases', headers=headers[role]).json()}
                assert c.get(case['images'][0]['source_url'], headers=headers[role]).status_code == 200
                perms = case['permissions']
                assert perms['can_review'] == (role in {'admin', 'doctor', 'clinician'})
                assert perms['can_upload'] == (role != 'viewer')
                assert perms['can_run_analysis'] == (role in {'admin', 'doctor', 'clinician', 'researcher'})
                assert perms['can_delete'] == (role in {creator, 'admin'})
                if role != creator:
                    assert any(n['case_id'] == cid for n in c.get('/api/notifications', headers=headers[role]).json())
            for role in ('viewer', 'researcher', 'technician'):
                assert c.post(f'/api/cases/{cid}/review', headers=headers[role], json={'decision': 'reviewed'}).status_code == 403
            assert c.patch(f'/api/cases/{cid}', headers=headers['doctor'], json={'source_reference': 'Team handoff'}).status_code == 200
            assert c.patch(f'/api/cases/{cid}', headers=headers['viewer'], json={'source_reference': 'Denied'}).status_code == 403
            assert c.delete(f'/api/cases/{cid}', headers=headers['viewer']).status_code == 403
            assert c.post(f'/api/cases/{cid}/review', headers=headers['clinician'], json={'decision': 'reviewed'}).status_code == 201
            assert c.get(f'/api/cases/{cid}', headers=headers['researcher']).json()['reviews']
        # New users and historical cases need no copied per-user assignments.
        later = login(c, 'viewer', '-later')
        assert set(created) <= {row['id'] for row in c.get('/api/cases', headers=later).json()}
        assert c.get('/api/dashboard/analytics', headers=later).json()['total_cases'] >= len(created)
        assert c.get('/api/tasks', headers=later).json() == []
        cid = created[-1]
        assert c.delete(f'/api/cases/{cid}', headers=headers['admin']).status_code == 200
        assert c.get(f'/api/cases/{cid}', headers=later).status_code == 404
        assert cid not in {row['id'] for row in c.get('/api/cases', headers=later).json()}
        # Reopening another session retains shared visibility.
    with TestClient(app) as c:
        assert c.get(f'/api/cases/{created[0]}', headers=login(c, 'viewer')).status_code == 200


def test_shared_mode_is_explicit_and_reversible(monkeypatch):
    monkeypatch.setenv('CV_CASE_VISIBILITY', 'assigned')
    with TestClient(app) as c:
        owner = login(c, 'researcher', '-policy')
        other = login(c, 'admin', '-policy')
        cid = c.post('/api/cases', headers=owner, json={'case_code': 'POLICY-EXISTING'}).json()['id']
        assert c.get(f'/api/cases/{cid}', headers=other).status_code == 404
        monkeypatch.setenv('CV_CASE_VISIBILITY', 'shared')
        assert c.get(f'/api/cases/{cid}', headers=other).status_code == 200
        monkeypatch.setenv('CV_CASE_VISIBILITY', 'assigned')
        assert c.get(f'/api/cases/{cid}', headers=other).status_code == 404
