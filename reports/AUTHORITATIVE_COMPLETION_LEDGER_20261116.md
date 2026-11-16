# CoroVision AI authoritative completion ledger — 16 November 2026

This ledger separates application verification from scientific validation. Training remains frozen. No checkpoint was changed or promoted. Deployment and Docker work remain paused by owner instruction.

## Frozen model and data audit

The retained 2D release is `corovision-preserved-2d-20261023`. Local byte hashes match its registry:

- Artery ResNet34 U-Net: `ea692f8c9c655791a44a340907629cda4e812138a6f15d93cdb2a45166177a7c`.
- Stenosis Mask R-CNN ResNet50-FPN: `f0bc898c95b6efdd53863d5a430fb4b850c2451b440c5a53b92a73e73c5be2e3`.
- ImageCAS 128-cube volume checkpoint: `b77271b1780f32100bc954ccbec2ac5c4efa54a10e0f5975b631924c8a2f553d`.

The six installed task-adapter hashes also match the application registry: anatomical instances `59422bb…`, aorta `3b0af653…`, archive lesions `57a42245…`, CADICA `9c4c7d52…`, DCA `654c99dd…`, and ImageCAS-X `8a978778…`.

The refreshed local manifest audit found nine dataset task packages and matching evidence hashes. It also found ImageCAS/ImageCAS-X case-ID intersections in every train/validation/test pairing. Those variants must not be treated as independent cohorts. The raw source drive was not mounted, so this run verified preserved manifests and evidence rather than rescanning raw pixels or patient metadata.

The detailed eligibility decision is in `EVALUATION_ELIGIBILITY_MATRIX_20261116.csv`.

## Task ledger

| ID | Requirement | Current implementation and evidence | Status | Scientific validation | Exact next action |
| --- | --- | --- | --- | --- | --- |
| DATA-01 | Dataset and checkpoint inventory | Frozen hashes, application contracts, exposure audit and refreshed local manifest evidence recorded | Software verified | Not independently validated | Recover original patient/study/video mappings and compare all retained checkpoint exposures before locking a cohort |
| DATA-02 | Duplicate and split leakage checks | Exact manifest IDs and preserved evidence are checked; ImageCAS/ImageCAS-X cross-variant intersections are documented | Development evaluated | Patient independence unresolved | Run source-level exact/perceptual duplicate audit only after raw sources and grouping keys are available |
| MODEL-01 | Frozen 2D segmentation | Retained ResNet34 U-Net is hash-pinned and executes through saved analysis | Software verified | Development-exposed metrics only | Evaluate once on an exposure-cleared locked cohort |
| MODEL-02 | Frozen 2D stenosis detection | Retained Mask R-CNN is hash-pinned; candidates, masks and scores persist to reports | Software verified | Development-exposed metrics only | Lock matching and threshold protocol, then evaluate on eligible lesion references |
| MODEL-03 | Frozen 3D segmentation | ImageCAS checkpoint is hash-pinned; native volume, saved mask, previews and exports are connected | Software verified | Independent CTA validation blocked | Acquire eligible lumen masks and calculate Dice, HD95, surface and topology metrics |
| GEO-2D-01 | Candidate-local MLD/RVD | Saved-mask path association, local cross-sections, reference selection, sensitivity and abstention are implemented | Software verified | Qualified measurement agreement blocked | Collect blinded endpoint measurements with calibration provenance |
| CAL-2D-01 | Physical calibration | Pixel units are preserved when calibration is unavailable; calibration schema and validity gates exist | Software verified | Physical accuracy blocked | Supply acquisition-specific verified scale or catheter/QCA calibration |
| GEO-3D-01 | Perpendicular 3D sections | Physical-coordinate centerlines, perpendicular areas/diameters, branch screening, fragmentation warnings and severity abstention are tested synthetically | Software verified | Independent CTA agreement blocked | Add eligible native-resolution reference masks and diameter pairs |
| SEV-01 | Research severity grading | Versioned measurement-based rules, quality gates, saved snapshots and 2D/3D reports are integrated | Software verified | Expert agreement blocked | Lock protocol, import matched qualified grades, report support/confusion matrix/macro F1/weighted kappa/abstentions |
| XAI-01 | Explainability display and integrity | 2D attribution artifacts and synthetic perturbation/integrity tests exist; saved outputs are bound to runs | Software verified | Frozen-checkpoint faithfulness incomplete | Execute target-specific occlusion/deletion and isolated-copy randomization on eligible development inputs |
| BROWSER-01 | 2D critical journey | Upload, analysis, candidates, saved-run refresh and report/evidence exports have recorded browser receipts | Browser verified in recorded fixtures | Not scientific validation | Re-run complete matrix on a fresh case including expiry, disabled user, invalid and oversized inputs |
| BROWSER-02 | 3D critical journey | Volume upload, inference, viewer, geometry/severity display, saved run and exports have recorded receipts | Browser verified in recorded fixtures | Not scientific validation | Re-run fresh eligible volume and validate every downloaded value against immutable snapshot |
| REPORT-01 | PDF/CSV/JSON/ZIP integrity | Severity, narrowing, references, provenance, research-only banner and snapshot hashes are implemented and regression-tested | Software verified | Reference-dependent claims remain blocked | Repeat browser download/reopen checks on fresh 2D and 3D runs |
| SEC-01 | Authentication, RBAC and case isolation | Automated login/session/role/cross-case and artifact-isolation tests pass in the application suite | Software verified | Not applicable | Complete interactive expired-session, disabled-user and keyboard acceptance evidence |
| CI-01 | Reproducible application checks | GitHub application CI passes on both maintained branches; backend, frontend and PDF conversion dependencies are provisioned | Complete | Not applicable | Keep CI green as application changes continue |
| DEPLOY-01 | Clean deployment and recovery | Static contracts and historical local evidence exist | Paused | Not verified in a clean deployment | Resume only after explicit owner instruction; Docker and deployment are currently out of scope |
| TRAIN-01 | Training readiness | Failure-analysis proposals and reproducibility fields exist; retained models remain frozen | Pending authorization | No new experiment authorized | Do not execute optimizer updates; first resolve evaluation eligibility and justify one hypothesis |

## Current blockers that software cannot manufacture

1. Exposure-cleared patients or studies with reliable grouping.
2. Qualified blinded MLD/RVD or QCA-style references and acquisition-specific calibration.
3. Matched expert severity categories under a locked protocol.
4. Eligible native-resolution CTA lumen masks and independent stenosis measurements.
5. Dataset access, licence and provenance records sufficient for redistribution or pooling decisions.

Until these are supplied, the accurate project state is an engineering-verified research prototype—not an independently validated or clinically validated system.

