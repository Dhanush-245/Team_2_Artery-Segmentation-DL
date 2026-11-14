# Milestone 3 mentor briefing: stenosis detection, severity and explainability

## 1. Milestone objective

Milestone 3 covers Weeks 5–6 of CoroVision AI. Its purpose is to extend the artery-segmentation foundation into a traceable research workflow that can localize possible stenosis, associate each candidate with vessel geometry, estimate narrowing only when the evidence is sufficient, expose explainability evidence, and present the result in the application without implying a clinical diagnosis.

The milestone is deliberately split into three levels:

1. **Model output:** immutable masks, boxes, polygons, scores and model/checkpoint identity.
2. **Derived research evidence:** coordinate transforms, candidate-to-vessel association, source-pixel width estimates, sensitivity checks and explicit abstention reasons.
3. **Human interpretation:** a separate reviewed measurement and research severity protocol. Human review never overwrites the original model event.

This separation is the main safety and reproducibility design decision. Detector confidence is not presented as percentage stenosis, a missing candidate is not interpreted as a normal artery, and pixel measurements are not presented as millimetres without calibration.

## 2. Task-by-task explanation

### Task 1 — Confirm that the lesion labels are suitable

**Why it matters:** A detector cannot be evaluated correctly unless the reference data identifies the same object the model is expected to predict. Coronary artery masks, lesion masks, boxes, source grades and clinical severity labels are different supervision types.

**What was done:**

- The workflow keeps artery segmentation, stenosis instance segmentation, source grades and reviewed severity as separate tasks.
- Candidate evidence records its label, source image, model version, checkpoint identity and coordinate frame.
- The application does not convert a bounding box into a fabricated lesion mask or map a source grade into a clinical category.
- Data and annotation compatibility requirements are documented before any independent evaluation is accepted.

**Current result:** The retained stenosis baseline has compatible development-set lesion masks for instance matching. The project still lacks an eligible independent cohort with complete provenance and calibrated expert diameter/reference measurements, so independent clinical performance is not claimed.

### Task 2 — Debug localization and coordinate transforms

**Why it matters:** A correct prediction in resized model coordinates can be displayed or measured in the wrong location if crop, padding, letterbox or scale metadata is lost.

**What was done:**

- Each saved analysis binds the case, image, source hash, run, model/checkpoint and preprocessing geometry.
- Candidates preserve prepared-coordinate and original/source-coordinate evidence.
- The inverse mapping accounts for saved crop/padding/resize geometry; unreliable mappings are explicitly rejected.
- The measurement workflow validates candidate bounds against the original image and refuses measurement when the mapping is unreliable.
- Saved-run links request an exact historical run. A missing run remains unavailable instead of silently falling back to the latest run.

**Mentor demonstration:** Open a saved case, select a candidate, show its overlay and original-coordinate evidence, then point out the saved run ID and coordinate-warning/abstention behavior.

### Task 3 — Train or evaluate the stenosis localization pipeline

**Retained model:** Mask R-CNN with a ResNet50-FPN backbone for stenosis instance masks.

**Frozen development evaluation:**

| Model arm | TP | FP | FN | Instance F1 at score 0.25 and mask IoU 0.5 | Decision |
|---|---:|---:|---:|---:|---|
| Retained baseline | 195 | 369 | 211 | 0.4021 | Retained |
| ROI-head refinement | 206 | 383 | 200 | 0.4141 | Rejected: gain below the 0.02 gate and 14 additional false positives |
| Classifier-only refinement | 196 | 375 | 210 | 0.4012 | Rejected: regression gates failed |

The evaluation unit is a matched lesion instance mask at IoU 0.5. These values must not be renamed as box AP, image classification accuracy or clinical diagnostic accuracy. On the 200-case development set, baseline false positives per image are 369/200 = 1.845.

A later frozen proposal diagnostic found that 394/406 references had a top-1,000 proposal with box IoU at least 0.5, while only 12/211 baseline mask misses lacked such proposal coverage. This failed the predeclared missing-proposal mechanism screen, so it did not justify new RPN training. Training remains paused.

### Task 4 — Extract and persist stenosis candidates

**What the application saves:** candidate ID, mask/polygon or bounding evidence when available, raw score, bounds, model/checkpoint lineage, run identity and coordinate warnings.

Candidate records are immutable model evidence. A candidate means "model-flagged region for research review," not "confirmed stenosis." Low-scoring or small lesions can be missed, and false positives remain material in the measured development results.

### Task 5 — Associate a candidate with vessel geometry

The application derives vessel contours, centerline paths and width profiles from the saved artery mask. Before measuring a candidate, it requires a unique centerline crossing and a single compatible vessel component. It abstains when there is no crossing path, multiple plausible paths, disconnected geometry, branch ambiguity or unreliable coordinates.

The displayed path ID is a geometric identifier, not an anatomical artery name. Anatomical identity is therefore not silently inferred.

### Task 6 — Estimate lumen narrowing with quality gates

For eligible candidates, the workflow compares a minimum local width with a stable nearby reference width in the same source-pixel frame:

```text
narrowing (%) = (reference width - minimum width) / reference width × 100
```

The implementation checks unique path association, branch exclusion, local boundary contrast, reference stability and boundary sensitivity. It repeats the measurement after one-source-pixel erosion and dilation; if a perturbation fails or the estimate is too unstable, the workflow abstains.

The automatic result is labelled an **experimental source-pixel mask-width estimate**. It is not a calibrated lumen diameter. Millimetre measurements require explicit calibration evidence and separate reviewer attestations.

### Task 7 — Assign research severity only when supported

Severity interpretation is downstream from measurement and is controlled by a versioned, researcher-authorized protocol. The application never derives severity directly from detector confidence.

The current experimental CAD-RADS-informed XCA intervals are:

- no measured narrowing: exactly 0%;
- minimal: greater than 0% and less than 25%;
- mild: 25% to less than 50%;
- moderate: 50% to less than 70%;
- severe: 70% to less than 100%.

These are research intervals, not official patient reporting. A possible 100% occlusion needs separate assessment. If sensitivity crosses a category boundary or the evidence gates fail, the result remains indeterminate/not assessable.

### Task 8 — Add explainability and visualization

The interface presents saved artery masks, lesion overlays, candidate bounds, contours, centerlines, selected path width profiles and original-coordinate measurement evidence. These views explain what evidence produced the displayed research result and allow the reviewer to inspect failure states.

It is important to distinguish evidence visualization from attribution validation. Probability overlays and deterministic explanations are available, but validated detector attribution maps, sanity checks and faithfulness measurements are still pending. The prepared forward-only diagnostic has synthetic checks only and has not been executed on an authorized independent run.

### Task 9 — Build the analysis dashboard and reporting workflow

The Analysis & Explainability workspace shows the exact saved run, candidate measurement summary, MLD/RVD values, narrowing, vessel path, sensitivity range, severity status and expandable evidence. It keeps automatic assessments separate from manually reviewed calibrated measurements.

Exports preserve run/model lineage and the distinction among unavailable, not assessed and recorded zero. A missing detection is never automatically reported as normal.

## 3. End-to-end workflow to demonstrate

1. Sign in with the research role and open **Research Cases**.
2. Select a de-identified case and its saved image.
3. Open the exact historical analysis run and verify its model/checkpoint and preprocessing identity.
4. Inspect the artery mask and stenosis candidate overlays.
5. Select a candidate and inspect its source-coordinate bounds, vessel path and width profile.
6. Open **Severity Assessment** and explain MLD, RVD, narrowing, quality gates and the sensitivity range.
7. Show an abstained/not-assessable candidate and explain why abstention is safer than inventing a number.
8. Expand original-coordinate evidence and distinguish automatic evidence from reviewer-entered measurements.
9. Open the report/export area and show that the saved run and limitations remain attached.

## 4. What is complete, experimental and pending

| Area | Status | Meaning |
|---|---|---|
| Saved candidate localization and overlays | Implemented | Traceable application workflow exists for compatible saved runs |
| Original-coordinate mapping and failure states | Implemented | Geometry is persisted and unreliable mappings abstain |
| Candidate/path association | Implemented with synthetic/software verification | Not anatomical vessel naming or clinical validation |
| Development-set stenosis instance evaluation | Completed for frozen arms | Baseline retained; refinements rejected |
| Automatic source-pixel narrowing estimate | Experimental | Mask-derived research descriptor only |
| Versioned research severity protocol | Experimental/guarded | Requires authorization and eligible measurement evidence |
| Saved evidence visualization | Implemented | Visual traceability, not attribution faithfulness proof |
| Independent clinical/reference validation | Pending | Eligible cohort and calibrated expert references are missing |
| Detector attribution faithfulness | Pending | Actual authorized maps and sanity/faithfulness receipts are missing |
| Further training | Paused | No training, fine-tuning or optimizer updates are authorized |

## 5. Main limitations to state clearly

- Results are from a reused development cohort, not an independent unseen-patient test set.
- Baseline lesion detection has substantial false positives and false negatives.
- Source-pixel mask widths are affected by segmentation errors, branches, foreshortening and projection geometry.
- Physical lumen diameter and clinical narrowing error cannot be reported without matched calibration and expert reference measurements.
- A missing detection cannot prove normal anatomy.
- Saved overlays explain recorded model evidence but do not establish causal attribution faithfulness.
- The application is a research prototype and must not be used for diagnosis or treatment decisions.

## 6. Short mentor summary

> In Milestone 3 we converted saved segmentation and lesion outputs into a traceable stenosis-research workflow. We verified candidate localization in original image coordinates, persisted immutable model evidence, associated candidates with vessel centerline geometry, and added guarded source-pixel narrowing estimates with contrast, reference-stability and boundary-sensitivity checks. We evaluated the retained Mask R-CNN baseline and rejected two refinements that did not pass the frozen improvement gates. The dashboard exposes candidates, overlays, paths, width profiles, severity protocol status and explicit abstention reasons. We do not convert confidence into stenosis percentage, infer normality from no detection, or claim calibrated clinical severity. Independent clinical/reference validation and attribution faithfulness remain pending, and training is paused.

## 7. Evidence references

- `docs/MILESTONE3_STENOSIS_ARCHITECTURE.md`
- `docs/MILESTONE3_MODEL_EVALUATION.md`
- `docs/MILESTONE3_DATA_AND_ANNOTATION_REQUIREMENTS.md`
- `docs/MILESTONE3_API_REFERENCE.md`
- `docs/MILESTONE2_3_STATUS_20261106.md`
- `backend/app/saved_measurement.py`
- `backend/app/candidate_path_association.py`
- `backend/app/narrowing.py`
- `frontend/src/StenosisMeasurements.tsx`
- `frontend/src/AnalysisWorkbench.tsx`
