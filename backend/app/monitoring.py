"""Central operational log and alerting.

* A persisted event log (table `operational_events`) with retention, readable by administrators.
* A small background monitor that checks memory, disk, server errors, failed analyses and readiness,
  and raises an alert in the application (a notification for every active administrator) and, when
  OPS_ALERT_WEBHOOK_URL is set, to a chat or paging webhook.

Events and alerts contain counts, route templates and request ids only: no patient data, request bodies,
tokens, file paths or exception text.
"""
import json
import logging
import os
import resource
import shutil
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from sqlalchemy import delete, func, select

from .database import SessionLocal
from .models import AnalysisJob, Notification, OperationalEvent, User

logger = logging.getLogger('corovision.operations')
LEVELS = ('info', 'warning', 'error', 'critical')
MAX_EVENTS = 5000
RETENTION_DAYS = 30
_WRITE_COUNT = 0
_ERROR_WINDOW = []  # timestamps of recorded 5xx events, to cap log storms
_LOCK = threading.Lock()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def settings() -> dict:
    """Thresholds and channels; every value can be overridden by an OPS_* environment variable."""
    return {
        'interval_seconds': _int('OPS_INTERVAL_SECONDS', 60),
        'cooldown_minutes': _int('OPS_COOLDOWN_MINUTES', 30),
        'memory_warn_percent': _int('OPS_MEMORY_WARN_PERCENT', 85),
        'memory_critical_percent': _int('OPS_MEMORY_CRITICAL_PERCENT', 95),
        'min_free_storage_mb': _int('OPS_MIN_FREE_STORAGE_MB', 1024),
        'critical_free_storage_mb': _int('OPS_CRITICAL_FREE_STORAGE_MB', 256),
        'server_errors_threshold': _int('OPS_SERVER_ERRORS_THRESHOLD', 5),
        'server_errors_window_minutes': _int('OPS_SERVER_ERRORS_WINDOW_MINUTES', 10),
        'failed_jobs_threshold': _int('OPS_FAILED_JOBS_THRESHOLD', 3),
        'failed_jobs_window_minutes': _int('OPS_FAILED_JOBS_WINDOW_MINUTES', 30),
        'snapshot_every_ticks': _int('OPS_SNAPSHOT_EVERY_TICKS', 5),
        'webhook_configured': bool(os.getenv('OPS_ALERT_WEBHOOK_URL', '').strip()),
    }


def enabled() -> bool:
    """On in production unless OPS_MONITOR=0; elsewhere only when OPS_MONITOR=1 (tests and local runs stay quiet)."""
    flag = os.getenv('OPS_MONITOR')
    if flag is not None:
        return flag == '1'
    return os.getenv('COROVISION_ENV', 'development') == 'production'


def record_event(level: str, kind: str, message: str, details: dict | None = None) -> None:
    """Write one event. Never raises: logging must not break a request or a job."""
    global _WRITE_COUNT
    level = level if level in LEVELS else 'info'
    try:
        with SessionLocal() as db:
            db.add(OperationalEvent(level=level, kind=kind[:48], message=message[:255],
                                    details_json=json.dumps(details or {}, default=str)[:4000]))
            db.commit()
        _WRITE_COUNT += 1
        if _WRITE_COUNT % 200 == 0:
            prune_events()
    except Exception:  # noqa: BLE001 - deliberately broad
        logger.warning('operational_event_not_saved kind=%s', kind)


def record_server_error(method: str, route: str, status: int, request_id: str) -> None:
    """Record a 5xx response, at most 30 per minute so a failing route cannot flood the log."""
    cutoff = time.monotonic() - 60
    with _LOCK:
        _ERROR_WINDOW[:] = [stamp for stamp in _ERROR_WINDOW if stamp > cutoff]
        if len(_ERROR_WINDOW) >= 30:
            return
        _ERROR_WINDOW.append(time.monotonic())
    record_event('error', 'http_5xx', f'{method} {route} returned {status}', {'request_id': request_id, 'route': route, 'status': status})


def prune_events() -> int:
    """Keep the newest MAX_EVENTS rows and nothing older than RETENTION_DAYS."""
    with SessionLocal() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
        removed = db.execute(delete(OperationalEvent).where(OperationalEvent.created_at < cutoff)).rowcount or 0
        total = db.scalar(select(func.count()).select_from(OperationalEvent)) or 0
        if total > MAX_EVENTS:
            keep_from = db.scalars(select(OperationalEvent.created_at).order_by(OperationalEvent.created_at.desc()).offset(MAX_EVENTS - 1).limit(1)).first()
            if keep_from is not None:
                removed += db.execute(delete(OperationalEvent).where(OperationalEvent.created_at < keep_from)).rowcount or 0
        db.commit()
        return removed


def list_events(db, *, limit: int = 100, level: str | None = None, kind: str | None = None) -> list[dict]:
    query = select(OperationalEvent).order_by(OperationalEvent.created_at.desc()).limit(max(1, min(limit, 500)))
    if level in LEVELS:
        query = query.where(OperationalEvent.level == level)
    if kind:
        query = query.where(OperationalEvent.kind == kind)
    return [{'id': row.id, 'created_at': row.created_at, 'level': row.level, 'kind': row.kind, 'message': row.message,
             'details': json.loads(row.details_json or '{}')} for row in db.scalars(query)]


# ---- signals ---------------------------------------------------------------------------------------------

def memory_signal() -> dict:
    """Process memory against the container limit when one exists (cgroup v2 or v1), else against OPS_MEMORY_LIMIT_MB."""
    used = None
    try:
        for line in open('/proc/self/status'):
            if line.startswith('VmRSS:'):
                used = int(line.split()[1]) * 1024
    except OSError:
        pass
    if used is None:
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        used = peak if os.uname().sysname == 'Darwin' else peak * 1024  # bytes on macOS, kilobytes on Linux
    limit = None
    override = _int('OPS_MEMORY_LIMIT_MB', 0)
    if override:
        limit = override * 1024 * 1024
    else:
        for path in ('/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'):
            try:
                raw = open(path).read().strip()
                if raw.isdigit() and int(raw) < 1 << 50:
                    limit = int(raw)
                    break
            except OSError:
                continue
    return {'used_bytes': used, 'limit_bytes': limit, 'percent': round(used * 100 / limit, 1) if limit else None}


def storage_signal(storage) -> dict:
    usage = shutil.disk_usage(storage)
    return {'free_bytes': usage.free, 'total_bytes': usage.total}


def recent_count(db, kind: str, minutes: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return db.scalar(select(func.count()).select_from(OperationalEvent)
                     .where(OperationalEvent.kind == kind, OperationalEvent.created_at >= cutoff)) or 0


def failed_jobs(db, minutes: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    column = getattr(AnalysisJob, 'completed_at', None) or AnalysisJob.created_at
    return db.scalar(select(func.count()).select_from(AnalysisJob).where(AnalysisJob.status == 'failed', column >= cutoff)) or 0


def collect_signals(db, storage, ready) -> dict:
    cfg = settings()
    return {'memory': memory_signal(), 'storage': storage_signal(storage), 'ready': bool(ready),
            'server_errors': recent_count(db, 'http_5xx', cfg['server_errors_window_minutes']),
            'failed_jobs': failed_jobs(db, cfg['failed_jobs_window_minutes'])}


def evaluate_conditions(signals: dict) -> list[dict]:
    """Pure function: which alert conditions hold right now."""
    cfg = settings()
    out = []
    memory = signals['memory']
    if memory['percent'] is not None:
        if memory['percent'] >= cfg['memory_critical_percent']:
            out.append({'name': 'memory_pressure', 'level': 'critical', 'message': f'Memory use is {memory["percent"]}% of the container limit; the service may be killed'})
        elif memory['percent'] >= cfg['memory_warn_percent']:
            out.append({'name': 'memory_pressure', 'level': 'error', 'message': f'Memory use is {memory["percent"]}% of the container limit'})
    free_mb = signals['storage']['free_bytes'] // (1024 * 1024)
    if free_mb < cfg['critical_free_storage_mb']:
        out.append({'name': 'low_storage', 'level': 'critical', 'message': f'Only {free_mb} MB of storage is free'})
    elif free_mb < cfg['min_free_storage_mb']:
        out.append({'name': 'low_storage', 'level': 'error', 'message': f'Only {free_mb} MB of storage is free'})
    if signals['server_errors'] >= cfg['server_errors_threshold']:
        out.append({'name': 'server_errors', 'level': 'error', 'message': f'{signals["server_errors"]} server errors in the last {cfg["server_errors_window_minutes"]} minutes'})
    if signals['failed_jobs'] >= cfg['failed_jobs_threshold']:
        out.append({'name': 'failed_analyses', 'level': 'warning', 'message': f'{signals["failed_jobs"]} analyses failed in the last {cfg["failed_jobs_window_minutes"]} minutes'})
    if not signals['ready']:
        out.append({'name': 'not_ready', 'level': 'critical', 'message': 'The readiness check is failing (database or models unavailable)'})
    return out


# ---- delivery --------------------------------------------------------------------------------------------

NOTIFICATION_KINDS = {'critical': 'ops_alert_critical', 'error': 'ops_alert', 'warning': 'ops_alert', 'info': 'ops_test'}


def notify_admins(db, level: str, message: str) -> int:
    kind = NOTIFICATION_KINDS.get(level, 'ops_alert')
    admins = db.scalars(select(User).where(User.role == 'admin', User.status == 'active')).all()
    for admin in admins:
        db.add(Notification(user_id=admin.id, case_id=None, kind=kind, message=message[:255]))
    return len(admins)


def post_webhook(level: str, name: str, message: str) -> str:
    """Send to OPS_ALERT_WEBHOOK_URL. Returns 'sent', 'not_configured' or 'failed'. The URL is never logged."""
    url = os.getenv('OPS_ALERT_WEBHOOK_URL', '').strip()
    if not url:
        return 'not_configured'
    parsed = urlparse(url)
    local = parsed.hostname in ('127.0.0.1', 'localhost', '::1')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and local):
        return 'failed'
    text = f'[CoroVision {level.upper()}] {message}'
    body = json.dumps({'text': text, 'content': text, 'level': level, 'alert': name, 'service': 'corovision-ai'}).encode()
    request = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310  # nosec B310 - https (or local http) enforced above
            return 'sent' if 200 <= response.status < 300 else 'failed'
    except (urllib.error.URLError, OSError, ValueError):
        return 'failed'


def deliver_alert(name: str, level: str, message: str) -> dict:
    with SessionLocal() as db:
        recipients = notify_admins(db, level, message)
        db.commit()
    webhook = post_webhook(level, name, message)
    record_event(level, f'alert_{name}'[:48], message, {'admins_notified': recipients, 'webhook': webhook})
    if webhook == 'failed':
        record_event('warning', 'alert_webhook_failed', 'The alert webhook could not be reached', {'alert': name})
    return {'admins_notified': recipients, 'webhook': webhook}


def fired_recently(db, name: str, minutes: int) -> bool:
    return recent_count(db, f'alert_{name}'[:48], minutes) > 0


def run_checks(storage, ready_fn) -> list[dict]:
    """One monitor tick: collect signals, fire new alerts (respecting the cooldown), note recoveries."""
    cfg = settings()
    fired = []
    with SessionLocal() as db:
        signals = collect_signals(db, storage, ready_fn())
        conditions = evaluate_conditions(signals)
        previously_open = {row.kind for row in db.scalars(select(OperationalEvent).where(
            OperationalEvent.kind.like('alert_%'),
            OperationalEvent.created_at >= datetime.now(timezone.utc) - timedelta(minutes=cfg['cooldown_minutes'])))}
        new = [c for c in conditions if f'alert_{c["name"]}'[:48] not in previously_open]
    for condition in new:
        fired.append({**condition, **deliver_alert(condition['name'], condition['level'], condition['message'])})
    active_kinds = {f'alert_{c["name"]}'[:48] for c in conditions}
    for kind in previously_open - active_kinds - {'alert_webhook_failed', 'alert_test'}:
        record_event('info', 'alert_resolved', f'{kind.removeprefix("alert_")} is back to normal', {'alert': kind.removeprefix('alert_')})
    return fired


def snapshot_metrics(storage, ready_fn, telemetry_snapshot) -> None:
    with SessionLocal() as db:
        signals = collect_signals(db, storage, ready_fn())
    routes = telemetry_snapshot()['routes']
    record_event('info', 'metrics_snapshot', 'Periodic metrics snapshot', {
        'requests': sum(row['requests'] for row in routes), 'server_errors': sum(row['errors'] for row in routes),
        'memory_percent': signals['memory']['percent'], 'memory_used_mb': signals['memory']['used_bytes'] // (1024 * 1024),
        'storage_free_mb': signals['storage']['free_bytes'] // (1024 * 1024), 'ready': signals['ready'],
        'failed_jobs_recent': signals['failed_jobs']})


class Monitor:
    """Background thread that runs the checks every OPS_INTERVAL_SECONDS."""

    def __init__(self, storage, ready_fn, telemetry_snapshot):
        self.storage, self.ready_fn, self.telemetry_snapshot = storage, ready_fn, telemetry_snapshot
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._loop, name='ops-monitor', daemon=True)
        self.last_run = None
        self.ticks = 0

    def start(self):
        self.thread.start()

    def close(self):
        self.stop.set()

    def _loop(self):
        interval = settings()['interval_seconds']
        while not self.stop.wait(interval):
            self.tick()

    def tick(self):
        try:
            self.ticks += 1
            run_checks(self.storage, self.ready_fn)
            if self.ticks % max(1, settings()['snapshot_every_ticks']) == 0:
                snapshot_metrics(self.storage, self.ready_fn, self.telemetry_snapshot)
            self.last_run = datetime.now(timezone.utc)
        except Exception:  # noqa: BLE001 - the monitor must never die
            logger.warning('ops_monitor_tick_failed')


MONITOR: Monitor | None = None
