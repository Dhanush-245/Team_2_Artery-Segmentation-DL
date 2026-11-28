# Reference-mask acceptance

The 25 November 2026 focused run passed **25 backend tests**, including 10 dedicated 2D mask-review tests, plus **55 frontend tests** and the TypeScript/Vite build. The opt-in browser test passed actual reference-file selection, invalid-file rejection and retry, saved metrics, reload, process-restart persistence and authenticated PDF/CSV/JSON downloads. Downloaded records agreed with the Evidence ZIP, and ZIP manifest hashes were checked. These checks used disposable **synthetic known-truth artifacts**, not patient images or independent expert references.

Run the focused backend checks from the repository root with the backend environment active:

```bash
PYTHONPATH=backend python -m pytest backend/tests/test_image_mask_review.py backend/tests/test_volume_reference_metrics.py backend/tests/test_segmentation_metrics.py backend/tests/test_volume_mask_review.py backend/tests/test_shared_case_workspace.py -q
```

For browser acceptance, first build the frontend with `npm run build` in `frontend/`. Then start the disposable harness from the repository root:

```bash
PYTHONPATH=backend python backend/tests/serve_reference_fixture.py --directory /tmp/coro-reference-acceptance --port 8010
```

In another terminal, from `frontend/`:

```bash
E2E_REFERENCE_FIXTURE=/tmp/coro-reference-acceptance/fixture.json E2E_BASE_URL=http://127.0.0.1:8010 npx playwright test e2e/reference-upload.spec.ts --project=desktop --workers=1
```

Install the Playwright Chromium browser if needed (`npx playwright install chromium`). The fixture requires the backend test and imaging dependencies. It never executes a model and refuses a storage directory inside the checkout. Keep its private credentials, database and downloads out of Git. Stop and restart the harness with the same directory, then repeat the browser test to check retained history. The normal application remains on port **8000**; 8010 is only a temporary isolated test server. Without `E2E_REFERENCE_FIXTURE`, this test is deliberately skipped.

**Remaining acceptance:** independent validation still needs a cleared unseen cohort, expert mask semantics and native-grid pairing. A real CTA case passing the strict candidate rules is still required for positive candidate navigation/measurement acceptance. Hosted authenticated workflows, recovery, monitoring and representative load need separate target evidence. Synthetic equality scores and local engineering passes do not satisfy these requirements.
