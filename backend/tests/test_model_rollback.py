"""One-step model rollback for the registered research checkpoints (module 16)."""
import json
from uuid import uuid4

from fastapi.testclient import TestClient

import app.main as main
from test_rbac_system import make_user


def _fake_models(tmp_path):
    root = tmp_path / 'models' / 'segmentation'
    for task in ('syntax', 'stenosis'):
        (root / task).mkdir(parents=True)
        for architecture in ('tiny_unet', 'attention_unet'):
            (root / task / f'{architecture}.pt').write_bytes(b'fake-checkpoint-' + architecture.encode())
    (root / 'comparison_report.json').write_text(json.dumps({'experiments': []}))
    return root


def _history(client, headers):
    return client.get('/api/analysis/models', headers=headers).json()


def test_rollback_steps_back_through_the_audited_history(monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'BASE_DIR', tmp_path)
    root = _fake_models(tmp_path)
    with TestClient(main.app) as client:
        _, admin = make_user(f'rb-admin-{uuid4().hex}@example.org', 'admin')
        _, ml = make_user(f'rb-ml-{uuid4().hex}@example.org', 'ml_engineer')
        # Nothing recorded yet: rollback is unavailable.
        assert client.post('/api/analysis/models/rollback', headers=admin).status_code == 409
        assert _history(client, admin)['can_rollback'] is False
        # tiny_unet first, then attention_unet.
        assert client.post('/api/analysis/models/activate', headers=admin, json={'architecture': 'tiny_unet'}).status_code == 200
        assert client.post('/api/analysis/models/activate', headers=admin, json={'architecture': 'attention_unet'}).status_code == 200
        state = _history(client, admin)
        assert state['active_architecture'] == 'attention_unet'
        assert state['can_rollback'] is True and state['rollback_target']['architecture'] == 'tiny_unet'
        # Only administrators may roll back; others cannot even see the control as usable.
        assert client.post('/api/analysis/models/rollback', headers=ml).status_code == 403
        assert _history(client, ml)['can_rollback'] is False
        done = client.post('/api/analysis/models/rollback', headers=admin)
        assert done.status_code == 200 and done.json()['architecture'] == 'tiny_unet'
        after = _history(client, admin)
        assert after['active_architecture'] == 'tiny_unet'
        assert after['history'][0]['event'] == 'model_rollback' and after['history'][0]['rolled_back_from'] == 'attention_unet'
        assert json.loads((root / 'promoted_model.json').read_text())['architecture'] == 'tiny_unet'
        # tiny_unet was the first activation, so there is nothing earlier: no toggling back and forth.
        assert after['can_rollback'] is False
        assert client.post('/api/analysis/models/rollback', headers=admin).status_code == 409


def test_rollback_refuses_when_the_earlier_checkpoints_are_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'BASE_DIR', tmp_path)
    root = _fake_models(tmp_path)
    with TestClient(main.app) as client:
        _, admin = make_user(f'rb-miss-{uuid4().hex}@example.org', 'admin')
        client.post('/api/analysis/models/activate', headers=admin, json={'architecture': 'tiny_unet'})
        client.post('/api/analysis/models/activate', headers=admin, json={'architecture': 'attention_unet'})
        (root / 'syntax' / 'tiny_unet.pt').unlink()
        assert _history(client, admin)['can_rollback'] is False
        assert client.post('/api/analysis/models/rollback', headers=admin).status_code == 409
        assert _history(client, admin)['active_architecture'] == 'attention_unet'


def test_the_hash_pinned_release_cannot_be_rolled_back_from_the_app(monkeypatch):
    monkeypatch.setattr(main.trained_release, 'configured', lambda: True)
    monkeypatch.setattr(main.trained_release, 'status', lambda: {'ready': True, 'models': []})
    with TestClient(main.app) as client:
        _, admin = make_user(f'rb-pin-{uuid4().hex}@example.org', 'admin')
        refused = client.post('/api/analysis/models/rollback', headers=admin)
        assert refused.status_code == 409 and 'redeploy' in refused.json()['detail'].lower()
        body = _history(client, admin)
        assert body['can_rollback'] is False and body['rollback_note']
