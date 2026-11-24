# Local operations and deployment readiness

> Status 24 Nov 2026: the container image has since been built, scanned and run in Docker, and a trial deployment exists on Railway. The statements below about deferred deployment and an uninstalled Docker describe the state on 25 October. For current monitoring and logging, see [MONITORING_AND_LOGGING.md](MONITORING_AND_LOGGING.md) and [RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md).

Deployment is deferred at the owner's request (25 October 2026). Packaging files
are preparation, not evidence of a successful container build or deployment.

## Operational endpoints

- `GET /api/health/live`: public process liveness, not model accuracy.
- `GET /api/health/ready`: database connectivity and installed model readiness;
  returns 503 when either dependency is unavailable.
- `GET /api/admin/operations`: administrator-only uptime, route-template request
  counts/durations, server errors, job counts, available storage and model readiness.
- `GET /api/admin/metrics`: administrator-only Prometheus text exposition.

Counters describe this single process and reset on restart. They are not GPU
utilization, model drift, remote Kaggle progress or persisted historical telemetry.
Request logs omit query strings, bodies, authorization headers and raw URL IDs.
Run one API worker while using the local inference queue. API responses disable
caching and include request IDs and basic browser security headers.

## Packaging prepared, not executed

`Dockerfile` builds the frontend and a non-root CPU inference service.
`compose.yaml` binds only to localhost, persists application data, mounts the
existing model release read-only, removes capabilities and disables demo access.
Production startup rejects missing/short JWT secrets and enabled demo-session flags.
Use a privately generated random JWT secret of at least 32 bytes and explicit
`CORS_ORIGINS`. Never put secrets or patient data into the image or Git repository.

Docker is not installed on the development laptop. Image build, dependency
resolution on target CPU architecture, container health checks, backup/restore,
TLS and deployment acceptance therefore remain unverified. Do not label the
application deployed or production-certified.

## Severity document review

The supplied comprehensive PRD, section 2.4, forbids percentage narrowing from
uncalibrated pixels. The training/optimization PRD, section 3.9, also requires
defensible calibration/spacing and measurement geometry. The master integration
prompt requires validated candidate-local/reference selection and a permitted
reference standard before calculating a percentage or applying categories.

No approved numerical category thresholds or measurement protocol were found in
these documents. Global mask diameter percentiles are not lesion-local reference
diameters. Automatic severity remains `insufficient_evidence`; human assessments
stay separate from AI outputs. This is a documented prerequisite, not a completed
severity classifier.

## Training and remaining acceptance gates

The owner supplied Kaggle profile `https://www.kaggle.com/mokshagnamannam`.
The profile alone does not select a notebook, dataset version or authorized job.
No new training, split changes, dataset pooling or checkpoint replacement was
performed. Review `DATASET_COMPATIBILITY_REPORT.md` before configuration changes.
Existing checkpoint inference and historical training evidence remain available.

Remaining work includes task-specific 3D inference parity/approval, a validated
severity protocol/model, authorized reproducible training runs, inference/load
benchmarks, broader security review, target-platform container testing and final
deployment/demo acceptance. Passing regression tests is not clinical validation
or proof that every milestone has been completed.

## Email password reset (SMTP)
Reset by emailed code is enabled only when `SMTP_HOST` and `SMTP_FROM` are set (`/api/auth/capabilities` then reports `email_reset: true`). Optional: `SMTP_PORT` (587 uses STARTTLS, 465 uses SSL), `SMTP_USERNAME`, `SMTP_PASSWORD`. On Railway add these as service variables (never commit them). Codes are six digits, expire in 10 minutes, allow five attempts, are rate limited, and a successful reset revokes every session. Verified by automated tests with a stubbed mail server; a live send needs real SMTP credentials and is a deploy-day check.

## Severity bands on a fresh install (demonstration)
Reviewer caliper percentages are mapped to research severity bands only after a researcher authorizes the experimental protocol (Severity Assessment, Research protocol). For a demo install set `CV_AUTHORIZE_RESEARCH_PROTOCOL=1` once: the app records the deployment owner's authorization at startup if no decision exists (an existing decision, including deactivation, is never overridden). Automatic mask-width estimates (exploratory, unvalidated) are now shown for every eligible candidate whether or not the protocol is authorized; candidates that fail the quality gates still abstain with the reason. Nothing here is a validated severity.
