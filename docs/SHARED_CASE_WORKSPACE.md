# Shared case workflow

The local merged application uses `CV_CASE_VISIBILITY=shared`. This is one team workspace: all active accounts with a case role can read existing and new non-deleted cases, source images, saved analyses and permitted reports without per-user assignment. Registration of a later account does not require copying historical grants. Inactive accounts cannot sign in. Model engineers retain model-only access.

| Role | Read shared cases | Intake and upload | Analyze | Expert review | Export |
|---|---|---|---|---|---|
| Administrator | Yes | Yes | Yes | Yes | Yes |
| Doctor / clinician | Yes | Yes | Yes | Yes | Yes |
| Researcher | Yes | Yes | Yes | No | Yes |
| Technician | Yes | Yes | Only with the existing operational grant | No | No |
| Viewer | Yes | No | No | No | No |
| Model engineer | No | No | No | No | No |

Report approval continues to require the separate approval flag. Only the owner or administrator can delete or assign access. Assignments in shared mode record collaboration; a read assignment does not downgrade the workspace role. No per-user grant is created implicitly. The original uploader remains the owner and reviewer identity/history remain intact.

Case creation, upload, analysis, edits and reviews use the existing notification mechanism, now addressed to active case-role users in shared mode. Existing role filters on specialist notifications still apply. The actor is excluded from ordinary collaboration notifications. The case list refreshes while a browser tab is visible; task queues select work from current case stage and the user's permitted actions.

The standard Compose default remains `assigned`: owners and explicit assignees only. `compose.merge-local.yaml` explicitly enables shared mode for this installation. Changing to assigned mode requires recreating the application container and restores the original grants; no data migration is performed. Shared mode applies across the whole deployment, with no organization boundary.

Engineering checks: `cd backend` then `.venv/bin/python -m pytest tests/test_shared_case_workspace.py tests/test_rbac_system.py tests/test_rbac_data_flow_matrix.py -q`. Tests use temporary SQLite/storage and generated image bytes, not clinical validation. They cover researcher/clinician/doctor uploads, all seven roles, images, notifications, role restrictions, later users, historical cases, reopening sessions, deletion and reverting to assigned mode.
