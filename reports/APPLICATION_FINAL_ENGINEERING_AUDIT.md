# Application final engineering audit — 17 November 2026

## Decision

The repository is an engineering-verified research demonstration, not a clinically validated system. Training remains paused and deployment was not performed.

## Retained model evidence

| Component | Registered model | Checkpoint SHA-256 | Status |
| --- | --- | --- | --- |
| 2D artery segmentation | ResNet34 U-Net | `ea692f8c9c655791a44a340907629cda4e812138a6f15d93cdb2a45166177a7c` | Preserved |
| Stenosis detection | Mask R-CNN ResNet50 FPN | `f0bc898c95b6efdd53863d5a430fb4b850c2451b440c5a53b92a73e73c5be2e3` | Preserved |

The release registry does not promote the rejected attention experiment. No optimizer step, training run, checkpoint mutation, or model promotion occurred during this closeout.

## Reproducible verification

- Backend: `322 passed, 5 skipped` in 69.64 seconds.
- Frontend unit tests: `20 passed`.
- Frontend production build: PASS, 2,408 modules transformed.
- Candidate-bound Grad-CAM implementation and focused integration tests: PASS.
- Current branch: `lingareddy-dhanush`; audited revision begins at `82b9a79`.

## Acceptance

Core 2D/3D application integration, saved-run isolation, authorization checks, report generation, abstention behavior, and frontend build are software verified. Fresh browser input/export reconciliation, 3D scientific measurement validation, XAI faithfulness, and independent clinical evidence remain incomplete. Overall: **PARTIAL**.
