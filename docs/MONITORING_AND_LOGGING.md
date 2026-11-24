# Monitoring and logging runbook

Status 24 Nov 2026. This describes what the application provides today and how to use it on the local Docker app and on the Railway deployment. It is basic operational visibility for a research demo, not a production observability stack.

## What the application provides
| Signal | Where | Notes |
|---|---|---|
| Liveness | `GET /api/health/live` | Process is up (public) |
| Readiness | `GET /api/health/ready` | Database, inference, storage, frontend, model availability (public, no patient data); 503 when a dependency is down |
| Request logs | Standard output, one JSON line per request | Fields: event, request id, method, route template, status, duration. No query strings, bodies, authorization headers or raw ids |
| Request id | `X-Request-ID` response header | Generated server-side; quote it when reporting a problem |
| Operations summary | `GET /api/admin/operations` (administrator) | Uptime, route counts and durations, server-error count, job counts, free storage, model readiness |
| Prometheus text | `GET /api/admin/metrics` (administrator) | `corovision_http_requests_total`, `corovision_http_request_duration_seconds_sum`, `corovision_process_uptime_seconds` |
| Audit events | Application database; `/api/auth/audit` (own), `/api/admin/audit` (administrator) | Sign-ins, case actions, reviews, report decisions, grants |
| User alerts | Notification bell and `/api/notifications` | Levels informational, low, medium, high, critical (analysis failed and validation failed are high) |

Limits: in-process counters reset on restart (the central log store below keeps history); paging is limited to in-app administrator alerts and an optional webhook. Run one API worker while the local inference queue is used.

## Where to look
- **Railway:** service, then Logs (request lines and Python errors), Metrics (CPU, memory, network), Deployments (build and healthcheck results). The healthcheck path is `/api/health/ready` (see `railway.json`).
- **Local Docker:** `docker logs <container>` and `docker stats`; health with `curl http://127.0.0.1:8000/api/health/ready`.

## What to watch and when to act
| Watch | Warning sign | Action |
|---|---|---|
| Memory (Railway Metrics) | Rising toward the plan limit during an analysis | Upgrade the plan or lower concurrency; restart if the container was killed |
| `/api/health/ready` | Not 200, or `inference` false | Check Logs for a model-load error; redeploy |
| Server errors (`/api/admin/operations`) | Count above zero after a release | Search Logs for the request id of a failing route |
| Failed analyses | Notifications of level high, job status failed | Open the case, read the error detail, rerun once; if it repeats, check storage and memory |
| Free storage (`/api/admin/operations`) | Below about 1 GB on the volume | Remove test cases, increase the volume |

## Setting basic alerts (manual)
1. Railway: use the project's notification settings for failed deployments and crashes.
2. Optional external check: point a free uptime monitor at `/api/health/ready` (public, no secrets) with a one-minute interval.
3. Optional metrics: scrape `/api/admin/metrics` with an administrator bearer token from a trusted machine; never put the token in a shared dashboard.

## Verification record
`hosted_tools.py verify` (deploy-day checklist) checks readiness, headers and a real analysis followed by a health check, which doubles as a memory sanity test. Keep each run's report with the deployment record.

## Central log store and alerting (added 24 Nov 2026)
- **Store:** table `operational_events` in the application database (SQLite locally, PostgreSQL hosted). It records service start/stop, server errors (with request id), failed jobs, resource warnings, periodic snapshots and alerts. It survives restarts. No patient data, query strings or tokens are stored.
- **Monitor:** a background thread (on by default when `COROVISION_ENV=production`; `OPS_MONITOR=1` or `0` forces it) checks memory (container cgroup limit, or `OPS_MEMORY_LIMIT_MB`), free storage, recent server errors and failed jobs every `OPS_INTERVAL_SECONDS`.
- **Alerts:** a breach creates a high or critical in-app notification for every administrator and, if `OPS_ALERT_WEBHOOK_URL` is set (Slack-style incoming webhook or any URL accepting a JSON POST), sends it there. The same alert repeats at most once per `OPS_COOLDOWN_MINUTES`.
- **Thresholds (defaults):** `OPS_MEMORY_WARN_PERCENT` 85, `OPS_MEMORY_CRITICAL_PERCENT` 95, `OPS_MIN_FREE_STORAGE_MB` 1024, `OPS_CRITICAL_FREE_STORAGE_MB` 256, `OPS_SERVER_ERRORS_THRESHOLD` 5 per `OPS_SERVER_ERRORS_WINDOW_MINUTES` 10, `OPS_FAILED_JOBS_THRESHOLD` 3 per `OPS_FAILED_JOBS_WINDOW_MINUTES` 30, `OPS_SNAPSHOT_EVERY_TICKS` 5.
- **Admin UI:** Administration, Operations page: live status, event history, alert list and a "send test alert" button (confirms the webhook path). API: `/api/admin/operations/events`, `/history`, `/alerts`, `/test-alert` (administrator only).
- **Hosted verification (deploy day):** after the first administrator exists, open Operations, press "Send test alert", confirm the bell notification (and the webhook message if configured), and confirm a `service_started` event after the redeploy. This has been verified locally and in automated tests only, not yet on the hosted host.
