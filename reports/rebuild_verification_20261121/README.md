# Rebuild and verification · 21 November 2026

Engineering verification only. No scientific or clinical claim.

## Build

`docker compose -p git-publish -f compose.yaml -f compose.3d.yaml -f compose.merge-local.yaml build` succeeded. Every layer was cached. The running port-8000 container already uses image config `sha256:6d7455c13c2e…` (Debian 13.7). It already contains the CSP/COOP middleware, `gradcam_plus_plus_url` and the uncommitted soft-deleted-case and inactive-user case-grant guards. No container recreate was needed. The new `tests/test_rbac_data_flow_matrix.py` passed (2 tests) in the backend venv.

## Security headers (HTTP, port 8000)

| Path | Status | Result |
|---|---|---|
| `/` | 200 | CSP, COOP `same-origin`, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` |
| `/api/health` | 200 | Same headers plus `Cache-Control: no-store` |
| `/docs`, `/openapi.json` | 404 | Hidden in production mode |
| `/api/cases` (anonymous) | 401 | Same headers plus `no-store` |

HSTS was absent, which is expected over plain HTTP. The built-in browser loaded the login route with no console or CSP errors.

## Grad-CAM++ on a positive case

- Input: ARCADE stenosis validation `18.png` (source image id 90, one annotated stenosis, bbox 187,78,64×26). SHA-256 `cad59f5c9702d998…`.
- Researcher session. Case `VERIFY-GRADCAMPP-024d68` (`b983fad5-288f-4be5-81f5-4963d80ab548`), image `a8e479dd-0c46-4507-949b-19af57102ed1`, job `9af9176c-b535-4371-b5ba-96fe177b990d` completed in 13.1 s. Run `92a7a61f-0783-4411-8527-dfdd079987d5`, model `corovision-preserved-2d-20261023`.
- One stenosis candidate was found (776 stenosis px, 8,500 artery px). The Grad-CAM, Grad-CAM++, attention and probability maps returned HTTP 200 as valid PNGs, and the two CAM maps are distinct files. An anonymous request for the Grad-CAM++ map returned 401.
- The Grad-CAM++ hotspot coincides with the annotated lesion (`gcpp.png`). It is limited to the candidate region, so this verifies feature availability, not attribution faithfulness. M3-02 remains open.
- The built frontend bundle (`AnalysisWorkbench-*.js`) contains the Grad-CAM++ layer. An interactive signed-in browser view of the layer was **not** performed.

## Offline Trivy rescan

`trivy image --image-src docker --offline-scan --skip-db-update --skip-java-db-update --skip-version-check --disable-telemetry --scanners vuln --severity HIGH,CRITICAL --format json git-publish-app:latest` (Trivy 0.76.2, DB updated 2026-11-19).

Result: **0 critical, 126 high** (`scan_6d7455.json`). Compared with the 123-row Debian 13 inventory:

- Added: urllib3 CVE-2026-97687 and CVE-2026-97689 (2.7.0 → fix 2.8.0), and msgpack CVE-2026-114613 and GHSA-6v7p-g79w-8964 (1.1.2 → fix 1.2.1/1.2.3).
- Removed: zlib1g CVE-2026-85091.
- Findings with a listed fix: these four plus setuptools CVE-2025-47273 (70.3.0).
- urllib3 2.7.0 and msgpack 1.1.2 are vendored inside pip 26.2.2 (`pip/_vendor/vendor.txt`). The application runtime has neither installed (`importlib.metadata` reports them absent). Runtime setuptools is 84.2.1, and the source of the 70.3.0 record was not located.

None of these findings is security-cleared. Candidate remediation is to remove pip from the runtime stage or upgrade it, then rebuild, rescan and regress.
