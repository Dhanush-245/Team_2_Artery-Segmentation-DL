# Full application regression — 17 November 2026

## Executed

| Layer | Command | Result |
| --- | --- | --- |
| Backend | `.venv/bin/python -m pytest -q -p no:cacheprovider` | 322 passed, 5 skipped, 51 dependency warnings |
| Frontend tests | `node --test tests/*.test.mjs` | 20 passed |
| Frontend build | `npm run build` | PASS; 2,408 modules transformed |

The five skips are opt-in external/model fixture checks and are not counted as verified behavior. Warnings are Starlette/httpx and scikit-image/NumPy deprecations, not test failures.

## Covered

API authorization, roles, case/run isolation, 2D/3D preprocessing, volume geometry, saved assessments, severity safeguards, report formats, protected artifacts, navigation state, and production compilation.

## Not completed in this closeout

Fresh connected-browser regression of every control, console inspection, responsive widths, keyboard traversal, error recovery, and end-to-end download/reopen. Overall regression: **PASS automated / NOT_TESTED fresh browser**.
