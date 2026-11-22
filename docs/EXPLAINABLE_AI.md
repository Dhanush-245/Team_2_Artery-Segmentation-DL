# Explainable AI — implementation and status

CoroVision uses **one shared XAI engine** (`backend/app/xai_engine.py`). Each explanation is saved as its own record for one case, saved run, checkpoint, target and method (`backend/app/xai_api.py`). This is research saliency, not a clinical explanation.

## Where it appears

| Place | What it shows |
|---|---|
| **Analysis → 2 · Explainable AI** (each 2D case run) | Target selector (each retained candidate, or the predicted vessel mask) and method selector. Heatmap over the prepared image with opacity control and candidate box. Provenance and hashes, per-target deletion/insertion check, measurement and severity rationale, method comparison, saved records and study evidence. |
| **Explainable AI** (sidebar, `/xai`) | Coverage across the runs you can open. Saved records by method, evidence inventory with filters and links back to each case. Study-level verification results and target definitions. |
| **Research report** (PDF, JSON, CSV, ZIP) | Section "Explainable AI — Research Interpretation". Holds the run's saved records, frozen into the report when it is created. The ZIP adds `xai_explanations.json` and hash-checked overlays. Older report versions say "XAI not generated". |

## Targets and methods

| Target | Definition | Layer |
|---|---|---|
| Stenosis candidate Cn | Mask R-CNN foreground score of the detection that re-identifies the saved candidate (mask IoU ≥ 0.5 with the saved polygon) | `backbone.body.layer4` |
| Vessel segmentation | Mean artery logit over the run-predicted vessel pixels (probability ≥ 0.5), ResNet34 U-Net | decoder `d0` |

| Method | Version | Notes |
|---|---|---|
| Grad-CAM | `gradcam-v3` | Mean-gradient channel weights |
| Grad-CAM++ | `gradcampp-v3` | Second/third-order positive-gradient weights; separately tested (`tests/test_xai_methods.py`) |
| Occlusion sensitivity | `occlusion-grid8-mean-v1` | Drop in the same target when each 64-px cell is set to the image mean. Runs in the background, about a minute on CPU. |

Mask-constrained variants are optional. They follow the predicted mask by design.

## Identity, storage and access

- **Record identity.** Each record is keyed by SHA-256 of: case, image, run, checkpoint SHA-256, task, target type and id, method, method version, target-definition version, preprocessing version, prepared-image SHA-256 and parameter hash. A matching identity is reused, never recomputed.
- **Storage.** Records live in `STORAGE/xai/<run>/<identity>.json`. Three PNGs sit beside each record (map, RGBA heatmap, overlay), and each artifact's SHA-256 is checked on every read; a mismatch returns 409.
- **Endpoints:**
  - `GET /api/cases/{case}/xai/{run}`
  - `POST …/explanations`
  - `GET …/explanations/{id}`
  - `GET …/explanations/{id}/{heatmap|overlay|map}.png`
  - `POST …/explanations/{id}/verification`
  - `GET /api/xai/summary`
- **Access.** Reading needs case read access. Generating or verifying needs analysis or review permission. A record is only reachable through its own case and run. The summary counts only cases the user can open.
- **Unsupported runs.** A run from another model release is UNSUPPORTED, and no other model is substituted. A run with zero candidates offers only the segmentation target.

## Verification evidence

- **Production parity.** For the single-candidate saved run of VERIFY-GRADCAMPP-024d68, the mask-constrained candidate maps equal the production saved maps exactly: Grad-CAM and Grad-CAM++ max abs diff 0.0.
- **Per-target deletion/insertion.** Protocol `corovision-forward-occlusion-v1`: 8×8 grid, image-mean baseline, one fixed random order, each advantage must be ≥ 0.01. Per-target model randomization is reported as NOT_TESTED.
- **Study level (M3-02, ARCADE validation, `reports/xai_faithfulness_20261122`).**
  - All four maps beat the random order on deletion and insertion (n = 24–25, p < 0.001).
  - Only raw Grad-CAM also passes model randomization, so it is the only map that is PASS overall. The other three are PARTIAL.
- **Historical 17 Nov check (C1/C2/C3).** Preserved as recorded: C1 deletion PASS / insertion FAIL; C2 FAIL / FAIL; C3 PASS / PASS; randomization NOT_EVALUABLE.

## Specification status

| Item | Status |
|---|---|
| Per-case XAI step for 2D runs; separate per-candidate maps; zero-candidate handling | Done |
| Segmentation-target XAI | Done |
| Grad-CAM, Grad-CAM++, occlusion; versioned; production parity | Done |
| Identity-keyed persistence, hashes, integrity check, authorization | Done (pytest) |
| Research dashboard (2D and 3D records) | Done |
| PDF/JSON/CSV/ZIP section | Done (ZIP hash reconciliation tested) |
| Faithfulness: per-target deletion/insertion; study-level randomization | Done; per-target randomization NOT_TESTED |
| 3D CTA volumetric attribution (Grad-CAM, Grad-CAM++, occlusion), native-grid alignment check, MPR overlay, 3D deletion/insertion | Done (see "3D CTA" below) |
| Clinical validity | Not assessed |

## 3D CTA

| Item | Value |
|---|---|
| Model | Retained ImageCAS 3D U-Net (`imagecas-coronary-unet3d-128-v1`, sha256 `b77271b1…`); other 3D models are UNSUPPORTED |
| Target | Mean vessel-minus-background logit over the voxels the model labels as vessel in its 128³ input grid |
| Methods | Grad-CAM 3D and Grad-CAM++ 3D at decoder block `dec[1]` (64³, trilinear to 128³); occlusion on a 4×4×4 block grid |
| Native geometry | The 128³ map is restored to the saved source grid with the run's coarse affine and `resample_from_to`, the same path as the saved vessel mask. Each record re-derives the model mask through that path and compares it with `mask_source.nii.gz` (Dice must be ≥ 0.999). |
| Slice overlay | The slice viewer samples each displayed slice from the 128³ map through the affines (identical to the full native resample, tested to < 1e-5) after checking the map's SHA-256 |
| Verification | 3D deletion/insertion: 4×4×4 blocks, volume-mean baseline, target relative to its unperturbed value, ranked vs one fixed random order, same 0.01 gates. Model randomization NOT_TESTED. |
| Storage | `STORAGE/volumes/<run>/xai/<identity>.json`, `.attr.nii.gz` (native uint8) and `.coarse.npy` (float16), hashed |
| Reports | 3D PDF section "Explainable AI — Research Interpretation"; evidence ZIP adds `xai_explanations.json` and the coarse maps |

**Observed on the public CTA demo case (DOCKER-PUBLIC-CTA).**
- **Alignment:** PASS, mask Dice 1.000 on the 512×512×321 grid.
- **Model output:** the model labels only 342 vessel voxels at 128³, and they lie posterior to the body contour rather than in the coronary tree.
- **Attribution:** Grad-CAM peaks on those voxels, with 5.6% of its energy inside them. Grad-CAM++ is diffuse.
- **What this shows:** the 3D model fails on this external scan. The explanation shows that failure; it does not hide it.
