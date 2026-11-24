# Model activation and rollback

Administrators manage the active segmentation model in Model management. Research use only.

## One-click rollback
`POST /api/analysis/models/rollback` (administrator) re-activates the model that was active before the current one. The Model management page shows a **Roll back** button with the target version; the call is recorded in deployment history and the audit log, and existing runs keep the model version they were created with.

## When it is blocked
When the hash-pinned preserved release is configured (the hosted and Docker default), the active model is fixed by checksum and activation or rollback is refused on purpose, so a stray click cannot swap the validated weights. The button is then disabled and shows the reason (`rollback_note`). To roll back in that mode, redeploy the previous application version, or install a second hash-verified release and restart.

## Evidence
`backend/tests/test_model_rollback.py` covers activation, rollback, the block under the preserved release and role restriction.
