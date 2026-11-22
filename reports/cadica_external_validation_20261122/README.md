# CADICA external validation · 22 November 2026

External check of the frozen `corovision-preserved-2d-20261023` release on CADICA, a dataset never used to train or select the installed models. No training, threshold change or tuning was performed.

**Scope.** 382 keyframes from 42 patients: one middle keyframe per selected video, giving 269 lesion and 113 non-lesion frames. CADICA stenosis categories are visual expert estimates, not QCA. Mean inference time was 4.8 s per frame on CPU; this includes periods when other jobs shared the CPU (about 1.6 s per frame when uncontended).

## Lesion detection (expert boxes, IoU ≥ 0.3)

| TP | FP | FN | Precision | Recall | F1 |
|---:|---:|---:|---:|---:|---:|
| 209 | 840 | 209 | 0.199 | 0.500 | 0.285 |

| CADICA label | Detected | Total | Recall |
|---|---:|---:|---:|
| p0_20 | 48 | 116 | 0.41 |
| p100 | 1 | 11 | 0.09 |
| p20_50 | 40 | 82 | 0.49 |
| p50_70 | 37 | 63 | 0.59 |
| p70_90 | 42 | 69 | 0.61 |
| p90_98 | 38 | 73 | 0.52 |
| p99 | 3 | 4 | 0.75 |

## Frame-level lesion vs no lesion

| TP | FN | FP | TN | Sensitivity | Specificity | FPR | FNR | AUC-ROC |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 247 | 22 | 85 | 28 | 0.918 | 0.248 | 0.752 | 0.082 | 0.748 |

## Severity agreement

The expert box was used as the candidate, so this isolates measurement and grading from detection. Of 418 lesions, 1 produced a measurement and 0 received a research category. Agreement with the CADICA grades therefore cannot be estimated.

| Abstention reason | Lesions |
|---|---:|
| low_local_boundary_contrast | 281 |
| ambiguous_vessel_paths | 77 |
| no_candidate_crossing_centerline | 27 |
| branch_ambiguity_in_candidate_region | 23 |
| multiple_vessel_components_in_candidate | 8 |
| invalid_path_or_candidate | 1 |

Most abstentions come from the local boundary-contrast gate. Changing that gate must be decided on ARCADE validation data and then re-checked here once. Tuning it on CADICA would invalidate this external check.

## Interpretation

- Lesion-level detection transfers weakly to CADICA: precision is low, with frequent false positives on non-lesion frames.
- Frame-level ranking (AUC) is moderate. The specificity reported here comes from the frozen operating point.
- Automatic severity remains unvalidated, and the app keeps grading as an exploratory, abstaining research estimate.

Not a clinical validation. Frames cluster within patients, so no patient-level confidence intervals are given. Local runner: `scripts/evaluate_cadica_external.py` (kept out of the published branch). Evidence served by the API: `ml/releases/external_validation_cadica_20261122.json`.
