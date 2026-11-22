# M3-02 detector Grad-CAM / Grad-CAM++ faithfulness checks (22 Nov 2026)

**Outcome: PARTIAL overall; raw Grad-CAM passes all three controls (see final results at the end).** The machinery is verified. A measured cascading-randomization result on 10 images shows
**Grad-CAM++ fails the model-randomization sanity check**. Insertion and deletion were measured on only **2
images**, which is too few for an aggregate claim. Faithfulness is **not established** for either saved map.
Research evidence only. No clinical validation.

## Scope and identity

| Item | Value |
|---|---|
| Checkpoint | stenosis Mask R-CNN R50-FPN, sha256 `f0bc898c95b6…5be2e3`. Hash-verified by `trained_release.ready()`. Frozen and never modified: randomization runs on deep copies. |
| Operating point | Saved application profile from the release manifest: score ≥ 0.1, mask ≥ 0.5. This is the profile that produced the saved maps. No threshold was changed. Note: the R-01 research decision froze 0.25 for a different, research-comparison profile. |
| Data | ARCADE stenosis **validation** split only. The test split was not loaded. |
| Eligibility | 200 images scanned. **196** have at least one retained candidate (`eligibility.json`). |
| Explained target | Each retained foreground candidate's detection score at `backbone.body.layer4`, as in the app. |
| Saved-map parity | Maps recomputed in this study versus `trained_release._detector_explanations` (the production function): max abs diff **0.0** over 20 comparisons on 10 images. |
| Maps assessed | `saved_gradcam` and `saved_gradcampp`: the saved app maps, constrained to each candidate's predicted mask and combined by maximum. `raw_gradcam` and `raw_gradcampp`: the same CAMs without the mask constraint, used as diagnostic controls. |

## Protocol

- **Deletion / insertion** (`corovision-forward-occlusion-v1`, predeclared):
  - The image is split into an 8×8 grid of 64×64-pixel cells, which are ranked by mean attribution.
  - The perturbation baseline is the per-image channel mean.
  - The score is the mean, over the original retained candidates, of the score of the detection that matches each one (mask IoU ≥ 0.1, 0 if lost).
  - The control is one equal-area random cell order (seed 20261114).
  - Gates: deletion AUC advantage ≥ 0.01, insertion AUC advantage ≥ 0.01, and |Spearman| ≤ 0.2 against the fully randomized model's map of the same form.
- **Cascading randomization** (Adebayo et al. 2018):
  - Weights are re-initialized cumulatively from output to input in this order: ROI predictors → ROI heads → RPN → FPN → layer4 → layer3 → layer2 → layer1+stem.
  - Each module's random weights are fixed by a per-name seed (base 20261122). FrozenBN layers are set to identity.
  - Each randomized copy keeps all detections (score_thresh 0). Its target is the detection that matches the original candidate. If none matches, the declared fallback is the copy's top-scoring foreground detection; the binding counts are reported per stage.
  - Similarity to the original map is measured by Spearman rank correlation (primary) and 7×7 SSIM.
- Code:
  - `backend/app/xai_detector_faithfulness.py` (sha256 `77d8c10b…`)
  - `backend/app/xai_faithfulness.py` (sha256 `ce4c4091…`)
- Runner: kept outside published source per AGENTS.md. `m3_02_xai_faithfulness_runner.py`, sha256 `d674d431…`, is in the session notes folder.
- Run on CPU with the backend venv (torch 2.14.1, torchvision 0.29.1).

## Results

### 1. Cascading weight randomization (n = 10 images: 1–7, 17, 18, 25)

Median Spearman ρ between the original map and the randomized-model map. Each cell also shows the number of
images with |ρ| ≤ 0.2. A sane map should fall to |ρ| ≈ 0 as soon as the top layers are randomized.

| Stage (cumulative) | raw Grad-CAM | raw Grad-CAM++ | saved Grad-CAM (constrained) | saved Grad-CAM++ (constrained) |
|---|---|---|---|---|
| ROI predictors | 0.01 (7/10) | **0.86 (0/10)** | 0.38 (1/9) | 0.38 (0/10) |
| ROI heads | −0.18 (3/10) | **0.77 (0/10)** | 0.44 (1/9) | 0.51 (0/10) |
| RPN | −0.12 (6/10) | **0.75 (0/10)** | 0.42 (2/9) | 0.44 (0/10) |
| FPN | 0.10 (9/10) | **0.83 (0/10)** | 0.30 (2/9) | 0.35 (1/10) |
| layer4 | 0.08 (8/10) | **0.55 (0/10)** | 0.29 (4/9) | 0.36 (0/10) |
| layer3 | −0.01 (10/10) | 0.34 (0/10) | 0.30 (2/9) | 0.36 (0/10) |
| layer2 | 0.05 (10/10) | 0.07 (8/10) | 0.14 (5/9) | 0.24 (4/10) |
| layer1 + stem | −0.04 (10/10) | 0.01 (6/10) | 0.27 (2/7) | 0.24 (3/10) |

What the table shows:
- **Raw Grad-CAM passes.** It decorrelates as soon as the detection head is randomized. It looks
  model-dependent.
- **Raw Grad-CAM++ fails.** Its map is almost unchanged until the backbone is randomized down to layer2. Its
  structure comes mainly from layer4 activations (input structure), not from the trained detector's decision.
  This matches the classic Adebayo failure mode.
- **Both saved (mask-constrained) maps fail at every stage (median ρ 0.24–0.51).** The predicted-mask
  constraint copies the candidate's location into the randomized map as well: the matched randomized detection
  usually overlaps the original candidate.
- **SSIM is not informative for the constrained maps.** It is about 0.96–0.99 because both maps are mostly
  zero. For the raw maps, SSIM agrees with ρ: raw Grad-CAM 0.03–0.18; raw Grad-CAM++ 0.52–0.91.
- Undefined ρ: saved Grad-CAM was all zero on 1 of 10 images (image 7). After some stages a constrained
  randomized map was constant, which makes ρ undefined. These cases are counted separately in `summary.json` and
  are not counted as passes.
- Target binding: the matched original candidate was used in 72 of 80 stage-image pairs. The declared
  top-detection fallback was used in 8, all at the FPN, layer2 and layer1+stem stages.

### 2. Deletion / insertion (n = 2 images: 1 and 18; 25 were planned)

| Map | Image | Deletion AUC (ranked / random) | Insertion AUC (ranked / random) | Gates (del, ins, rand) |
|---|---|---|---|---|
| saved Grad-CAM | 1 | 0.009 / 0.060 | 0.816 / 0.361 | ✓ ✓ ✓ |
| saved Grad-CAM | 18 | 0.008 / 0.156 | 0.651 / 0.170 | ✓ ✓ undefined (constant randomized map) |
| saved Grad-CAM++ | 1 | 0.006 / 0.060 | 0.816 / 0.361 | ✓ ✓ ✓ |
| saved Grad-CAM++ | 18 | 0.008 / 0.156 | 0.831 / 0.170 | ✓ ✓ ✓ |
| raw Grad-CAM | 1 | 0.009 / 0.060 | 0.572 / 0.361 | ✓ ✓ ✓ |
| raw Grad-CAM | 18 | 0.051 / 0.156 | 0.640 / 0.170 | ✓ ✓ ✓ |
| raw Grad-CAM++ | 1 | 0.007 / 0.060 | 0.436 / 0.361 | ✓ ✓ ✓ |
| raw Grad-CAM++ | 18 | 0.031 / 0.156 | 0.804 / 0.170 | ✓ ✓ ✗ (ρ 0.41) |

All maps beat one random order on both curves for these 2 images. With n = 2 and a single random order, no
aggregate or significance statement is made. The 23 remaining sampled images (`eligibility.json` →
`occlusion_sample_ids`) were not measured.

### 3. Localization (descriptive, not faithfulness; n = 10)

| Map | Peak inside annotated lesion | Mean energy inside lesion |
|---|---|---|
| saved Grad-CAM | 7/10 | 0.69 (n = 9; 1 all-zero map) |
| saved Grad-CAM++ | 6/10 | 0.64 |
| raw Grad-CAM | 2/10 | 0.11 |
| raw Grad-CAM++ | 3/10 | 0.02 |

The lesion overlap of the saved maps (including the 21 Nov image-18 observation) comes mostly from the
predicted-mask constraint. The unconstrained gradient attribution concentrates little of its energy on the
annotated lesion.

## Acceptance

| Check | Status | Scope |
|---|---|---|
| Saved-map identity and spatial mapping (parity with the production function) | **PASS** | 10 images, max diff 0.0 |
| Cascading randomization, raw Grad-CAM | PASS (sanity only) | 10 images |
| Cascading randomization, raw Grad-CAM++ | **FAIL** | 10 images |
| Cascading randomization, saved constrained maps | **FAIL** (constraint retains location) | 10 images |
| Deletion / insertion vs random baseline | **INCOMPLETE** | 2 of 25 planned images measured; both favourable |
| Clinical explainability | Not assessed | — |

## Why the run stopped

At start the detector took 0.7 s per forward pass on CPU. During the run the host was memory-starved: swap was
13.7 of 14 GB used and the load average was 240–418, mostly from other applications. Forward passes slowed to
about 24 s. One occlusion image took 2.4–3.4 h. The runs were stopped and the measured rows kept. Images 1, 18
and 1–7 were measured by the first launch. The runner was then changed only for resuming and memory handling;
the randomization and seeding logic is unchanged.

## Next action

Re-run on an uncontended host, or in the `git-publish-app` container with read-only mounts:

```bash
python <runner> occlusion <out> 0 1
python <runner> randomization <out>
python <runner> aggregate <out>
```

At about 0.7 s per forward pass, the remaining 23 occlusion images take about 3–4 h. Product follow-up for
review: label the saved maps as "mask-constrained" (location follows the predicted mask), and do not present
Grad-CAM++ as model-faithful.

## Files

- `summary.json`: aggregates with sample counts, per-image occlusion metrics and per-stage randomization statistics.
- `occlusion_per_image.json`: full deletion and insertion results per map.
- `randomization_per_image.json`: per-image, per-stage similarities, target bindings and localization descriptors.
- `eligibility.json`: per-image candidate counts and scores for all 200 validation images, plus the seeded sample.

## Final deletion / insertion results (completed 22 Nov 2026, n = 25)

The 23 remaining sampled validation images were measured on an uncontended host with the same runner (sha256 `d674d431…`); the two earlier rows were kept. Aggregation needed one fix: a missing randomized similarity (`None`, constant map) is now counted as undefined instead of crashing. No measurement, threshold or gate changed.

| Map | Images | Deletion advantage, median (bootstrap 95% CI of mean) | Insertion advantage, median (CI) | One-sided Wilcoxon p (del / ins) | Deletion gate | Insertion gate | Full-randomization gate (abs rho <= 0.2) |
|---|---|---|---|---|---|---|---|
| saved gradcam | 24 of 25 | 0.108 (0.081–0.170) | 0.336 (0.273–0.351) | 4.2e-06 / 6.0e-08 | 22/24 | 24/24 | 12/24 (3 undefined) |
| saved gradcampp | 25 of 25 | 0.107 (0.091–0.175) | 0.343 (0.301–0.405) | 3.0e-08 / 3.0e-08 | 23/25 | 25/25 | 8/25 |
| raw gradcam | 25 of 25 | 0.102 (0.072–0.165) | 0.329 (0.280–0.369) | 7.5e-06 / 3.0e-08 | 21/25 | 25/25 | 22/25 |
| raw gradcampp | 25 of 25 | 0.090 (0.085–0.170) | 0.321 (0.265–0.392) | 6.0e-08 / 3.0e-08 | 22/25 | 25/25 | 12/25 |

**Reading.** Every map beats an equal-area random order on both curves, with large and consistent effects. The model-randomization control separates the maps: raw Grad-CAM stays near zero correlation with a fully randomized detector (22 of 25), while the mask-constrained maps and raw Grad-CAM++ often keep the same structure. Together with the cascading result above (n = 10), only **raw Grad-CAM** passes all three controls at study level.

## Final acceptance (M3-02)

| Map | Deletion / insertion (n = 25) | Model randomization | Study-level result |
|---|---|---|---|
| raw Grad-CAM | PASS | PASS (cascading: median |rho| <= 0.2 at every stage, n = 10; full randomization 22/25) | **PASS** (research faithfulness controls) |
| raw Grad-CAM++ | PASS | FAIL | PARTIAL |
| mask-constrained Grad-CAM (saved app map) | PASS | FAIL (location kept by the mask) | PARTIAL |
| mask-constrained Grad-CAM++ (saved app map) | PASS | FAIL | PARTIAL |

Scope: ARCADE stenosis validation split only, frozen checkpoint f0bc898c, saved operating point. Development-exposed data; no independent cohort; clinical explainability not assessed. Product consequence: the case Explainable AI step defaults to raw (unconstrained) maps and offers the mask constraint as an option.
