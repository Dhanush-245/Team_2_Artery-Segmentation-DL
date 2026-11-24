"""Central operational log, alert checks, webhook delivery and the admin endpoints."""
import json
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

import app.main as main
from app import monitoring
from app.database import SessionLocal
from app.models import OperationalEvent
from test_rbac_system import make_user


def _clear():
    from app.database import Base, engine
    Base.metadata.create_all(bind=engine)  # the app creates tables at startup; make this file runnable on its own
    with SessionLocal() as db:
        db.execute(delete(OperationalEvent))
        db.commit()


def _signals(**overrides):
    base = {'memory': {'used_bytes': 100, 'limit_bytes': 1000, 'percent': 10.0},
            'storage': {'free_bytes': 50 * 1024 ** 3, 'total_bytes': 100 * 1024 ** 3},
            'ready': True, 'server_errors': 0, 'failed_jobs': 0}
    base.update(overrides)
    return base


def test_events_are_saved_listed_filtered_and_pruned(monkeypatch):
    _clear()
    monitoring.record_event('info', 'service_started', 'started', {'environment': 'test'})
    monitoring.record_event('error', 'http_5xx', 'GET /api/x returned 500', {'route': '/api/x'})
    monitoring.record_event('nonsense-level', 'custom', 'x' * 400)
    with SessionLocal() as db:
        events = monitoring.list_events(db)
        assert [e['kind'] for e in events][:3] == ['custom', 'http_5xx', 'service_started']
        assert len(events[0]['message']) == 255 and events[0]['level'] == 'info'
        assert [e['kind'] for e in monitoring.list_events(db, level='error')] == ['http_5xx']
        assert [e['kind'] for e in monitoring.list_events(db, kind='service_started')] == ['service_started']
    monkeypatch.setattr(monitoring, 'MAX_EVENTS', 2)
    assert monitoring.prune_events() >= 1
    with SessionLocal() as db:
        assert len(monitoring.list_events(db)) == 2
    with SessionLocal() as db:  # nothing older than the retention period survives
        db.add(OperationalEvent(level='info', kind='old', message='old', created_at=datetime.now(timezone.utc) - timedelta(days=31)))
        db.commit()
    monitoring.prune_events()
    with SessionLocal() as db:
        assert 'old' not in [e['kind'] for e in monitoring.list_events(db)]


def test_thresholds_map_signals_to_levels():
    assert monitoring.evaluate_conditions(_signals()) == []
    warn = monitoring.evaluate_conditions(_signals(memory={'used_bytes': 1, 'limit_bytes': 100, 'percent': 88.0}))
    assert [(c['name'], c['level']) for c in warn] == [('memory_pressure', 'error')]
    crit = monitoring.evaluate_conditions(_signals(memory={'used_bytes': 1, 'limit_bytes': 100, 'percent': 97.0}))
    assert crit[0]['level'] == 'critical'
    assert monitoring.evaluate_conditions(_signals(memory={'used_bytes': 1, 'limit_bytes': None, 'percent': None})) == []
    low = monitoring.evaluate_conditions(_signals(storage={'free_bytes': 500 * 1024 ** 2, 'total_bytes': 1}))
    assert low[0]['name'] == 'low_storage' and low[0]['level'] == 'error'
    assert monitoring.evaluate_conditions(_signals(storage={'free_bytes': 100 * 1024 ** 2, 'total_bytes': 1}))[0]['level'] == 'critical'
    names = {c['name'] for c in monitoring.evaluate_conditions(_signals(server_errors=9, failed_jobs=4, ready=False))}
    assert names == {'server_errors', 'failed_analyses', 'not_ready'}


def test_an_alert_notifies_admins_once_then_cools_down_and_reports_recovery(monkeypatch):
    _clear()
    monkeypatch.delenv('OPS_ALERT_WEBHOOK_URL', raising=False)
    state = {'signals': _signals(ready=False)}
    monkeypatch.setattr(monitoring, 'collect_signals', lambda db, storage, ready: state['signals'])
    with TestClient(main.app) as client:
        admin_user, admin = make_user(f'ops-admin-{uuid4().hex}@example.org', 'admin')
        _, viewer = make_user(f'ops-view-{uuid4().hex}@example.org', 'viewer')
        fired = monitoring.run_checks(main.STORAGE, lambda: False)
        assert [a['name'] for a in fired] == ['not_ready'] and fired[0]['admins_notified'] >= 1
        alerts = {n['kind']: n for n in client.get('/api/notifications', headers=admin).json()}
        assert alerts['ops_alert_critical']['alert_level'] == 'critical' and 'readiness' in alerts['ops_alert_critical']['message']
        assert 'ops_alert_critical' not in {n['kind'] for n in client.get('/api/notifications', headers=viewer).json()}
        assert monitoring.run_checks(main.STORAGE, lambda: False) == []  # cooldown: no second alert
        state['signals'] = _signals()
        monitoring.run_checks(main.STORAGE, lambda: True)
        with SessionLocal() as db:
            kinds = [e['kind'] for e in monitoring.list_events(db)]
        assert 'alert_not_ready' in kinds and 'alert_resolved' in kinds


class _Sink(BaseHTTPRequestHandler):
    received = []

    def do_POST(self):
        _Sink.received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


def test_webhook_delivery_and_the_test_alert_endpoint(monkeypatch):
    _clear()
    _Sink.received.clear()
    server = HTTPServer(('127.0.0.1', 0), _Sink)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        monkeypatch.setenv('OPS_ALERT_WEBHOOK_URL', f'http://127.0.0.1:{server.server_port}/hook')
        with TestClient(main.app) as client:
            _, admin = make_user(f'ops-hook-{uuid4().hex}@example.org', 'admin')
            _, researcher = make_user(f'ops-res-{uuid4().hex}@example.org', 'researcher')
            assert client.post('/api/admin/operations/test-alert', headers=researcher).status_code == 403
            assert client.post('/api/admin/operations/test-alert').status_code == 401
            result = client.post('/api/admin/operations/test-alert', headers=admin).json()
        assert result['webhook'] == 'sent' and result['admins_notified'] >= 1
        payload = _Sink.received[0]
        assert payload['alert'] == 'test' and payload['level'] == 'info' and payload['service'] == 'corovision-ai'
        assert payload['text'].startswith('[CoroVision INFO]') and payload['text'] == payload['content']
        assert 'token' not in json.dumps(payload).lower()
    finally:
        server.shutdown()


def test_unsafe_or_unreachable_webhooks_fail_safely_and_never_log_the_url(monkeypatch):
    _clear()
    monkeypatch.setenv('OPS_ALERT_WEBHOOK_URL', 'http://example.org/hook')  # plain http to a public host is refused
    assert monitoring.post_webhook('error', 'x', 'm') == 'failed'
    monkeypatch.setenv('OPS_ALERT_WEBHOOK_URL', 'http://127.0.0.1:9/hook')  # nothing listens
    assert monitoring.post_webhook('error', 'x', 'm') == 'failed'
    monkeypatch.delenv('OPS_ALERT_WEBHOOK_URL')
    assert monitoring.post_webhook('error', 'x', 'm') == 'not_configured'
    monkeypatch.setenv('OPS_ALERT_WEBHOOK_URL', 'http://127.0.0.1:9/secret-path-123')
    monitoring.deliver_alert('x', 'error', 'unreachable')
    with SessionLocal() as db:
        assert 'secret-path-123' not in json.dumps(monitoring.list_events(db), default=str)
        assert any(e['kind'] == 'alert_webhook_failed' for e in monitoring.list_events(db))


def test_a_server_error_is_recorded_with_its_route_template_and_request_id():
    _clear()
    probe = FastAPI()
    probe.include_router  # noqa: B018 - keep the import used
    route = f'/api/_ops_probe_{uuid4().hex[:6]}/{{item}}'

    @main.app.get(route)
    def boom(item: str):
        raise RuntimeError('private detail that must not be stored')

    with TestClient(main.app, raise_server_exceptions=False) as client:
        _, admin = make_user(f'ops-err-{uuid4().hex}@example.org', 'admin')
        response = client.get(route.replace('{item}', 'PATIENT-SECRET'))
        assert response.status_code == 500
        events = client.get('/api/admin/operations/events?kind=http_5xx', headers=admin).json()['events']
    mine = [e for e in events if e['details'].get('route') == route]
    assert mine and mine[0]['level'] == 'error' and mine[0]['details']['request_id'] == response.headers['X-Request-ID']
    text = json.dumps(events)
    assert 'PATIENT-SECRET' not in text and 'private detail' not in text


def test_admin_endpoints_expose_alert_state_history_and_events_to_administrators_only(monkeypatch):
    _clear()
    monkeypatch.delenv('OPS_ALERT_WEBHOOK_URL', raising=False)
    with TestClient(main.app) as client:
        _, admin = make_user(f'ops-ep-{uuid4().hex}@example.org', 'admin')
        _, ml = make_user(f'ops-ml-{uuid4().hex}@example.org', 'ml_engineer')
        for path in ('/api/admin/operations/events', '/api/admin/operations/alerts', '/api/admin/operations/history'):
            assert client.get(path).status_code == 401
            assert client.get(path, headers=ml).status_code == 403
        body = client.get('/api/admin/operations/alerts', headers=admin).json()
        assert body['channels'] == {'in_app_admin_notifications': True, 'webhook': False}
        assert body['signals']['memory']['used_bytes'] > 0 and body['signals']['storage']['free_bytes'] > 0
        assert {'memory_warn_percent', 'min_free_storage_mb', 'server_errors_threshold'} <= set(body['settings'])
        assert 'webhook_url' not in json.dumps(body)
        monitoring.record_event('info', 'metrics_snapshot', 'snap', {'requests': 3, 'memory_percent': None})
        assert client.get('/api/admin/operations/history?hours=1', headers=admin).json()['snapshots'][0]['requests'] == 3
        assert client.get('/api/admin/operations/events?limit=1&level=info', headers=admin).json()['retention']['days'] == 30


def test_the_monitor_runs_only_when_enabled(monkeypatch):
    monkeypatch.delenv('OPS_MONITOR', raising=False)
    monkeypatch.setenv('COROVISION_ENV', 'development')
    assert monitoring.enabled() is False
    monkeypatch.setenv('COROVISION_ENV', 'production')
    assert monitoring.enabled() is True
    monkeypatch.setenv('OPS_MONITOR', '0')
    assert monitoring.enabled() is False
    monkeypatch.setenv('COROVISION_ENV', 'development')
    monkeypatch.setenv('OPS_MONITOR', '1')
    assert monitoring.enabled() is True
