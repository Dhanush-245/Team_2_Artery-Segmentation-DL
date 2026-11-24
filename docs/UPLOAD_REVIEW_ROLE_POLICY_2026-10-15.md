# Upload, analysis and review policy

> Updated 24 Nov 2026: the administrator rules below now match the code and tests (administrators have default operational actions; case access is still ownership or assignment). The original 15 Oct wording is kept in parentheses where it changed.

Implemented from the user's second pasted role/workflow specification. This is
a research prototype on FastAPI/SQLAlchemy, not Express/Firestore.

## Operational actions

`backend/app/action_policy.py` defines server-side default and conditional actions.
The current account status, role and stored grants are evaluated on each request.
The frontend receives effective permissions from `/api/auth/me`; changing browser
state does not grant API authority.

- Researchers: own/assigned research case preparation, analysis and authorized
  research exports. Read-only assignments do not permit new analysis runs.
- Technicians: case preparation and authorized image uploads. Analysis requires
  a separately recorded `analysis:run` grant plus owner/review/edit scope. No
  clinical review, report approval, model activation or result-export authority.
- Doctors and clinical reviewers: upload and inspect authorized cases, run
  supported analysis within owner/review/edit scope, and record human reviews.
  Case uploads require ownership or edit access; review access alone is not upload
  access. Report approval remains a separate grant and is a research-review record,
  not a legally certified clinical signature or a clinical-validation claim.
- ML engineers: recorded model registry and evaluation, without medical case
  access or activation. Training controls and candidate submission remain pending.
- Administrators: governance, audited research-checkpoint activation and, since
  the later role update, the same default operations as doctors (create cases,
  upload, run analysis, export, record clinical review). Medical record access
  still requires ownership or an explicit case assignment, so an administrator
  cannot open another person's case without it. (Superseded text from 15 Oct:
  "without automatic case creation, upload, analysis or case-export permissions,
  each needing a grant by a different administrator".) Operational grants for
  these four actions are therefore redundant for administrators; disabling one
  does not remove the default. See `backend/app/action_policy.py` and
  `test_operational_policy.py`, and `AUTH_ROLES.md` for the current matrix.
- Standard User / Viewer: unchanged read-only case details, recorded findings and
  assigned clinicians. No upload, analysis, clinical sign-off or model controls.

## Grant administration

Administration → Separate operational grants supports `case:create`, `case:upload`,
`analysis:run`, and `analysis:export` only where the target role's conditional
policy permits them. A reason is required; every decision is audited. A user cannot
grant themselves operational access. Role changes clear stored operational grants
to prevent old privileges returning when a user later switches back to a role.

No real user was given an additional grant by the agent. Existing account roles
and medical assignments were preserved; defaults are more restrictive. Existing
technician analysis/admin operational actions may therefore require authorization
before use. Refresh/sign in again to update cached navigation after a grant;
server-side revocation takes effect on subsequent API requests regardless.

## Case workflow and duplicate checks

Authorized upload → validation/preprocessing → explicitly authorized AI analysis →
human review → research report approval where separately granted. A researcher can
use research results without clinical approval; exports retain research-use warnings.
Duplicate active case references are rejected within the same owner's workspace,
without revealing another user's records. Existing exact-upload hash checks remain.
The reference pre-check is not a concurrency-proof unique database constraint.

Technician preparation entry points and doctor vs imaging-review guidance were
added to the role workspace. These link to working shared tools; they are not
claims that every named section is a standalone service.

## Explicitly unfinished

“Demo Institutional Researcher” still maps to `researcher`. Display names and email
domains do not confer institution-wide rights. Membership, shared dataset grants,
batch mask/annotation registry imports, team projects, retention and institution
management need a real scoped data model and workflows before enabling access.
Dataset upload approval is not inferred from permission to upload a single case.

No validated automated severity model, live compute monitor, training-control API,
production deployment approval gate or new clinical validation was added. Training
remains paused. Unconnected capabilities are labelled accordingly.

## Checks

44 selected tests passed across operational grants, authentication, role/access
requests, case isolation, shared review workflow, registry activation, image intake
and volume preparation. Test inference is mocked/unavailable; no training was run.
Frontend TypeScript/Vite build passed, with the existing bundle-size advisory.
