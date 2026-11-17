# Project requirements acceptance matrix — 17 November 2026

| Requirement | Code | Actual test | Browser | Provenance | Research status | Remaining blocker | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2D artery segmentation | Implemented | Full regression | Historical | Checkpoint hash locked | Development evaluated | Independent cohort | PARTIAL |
| Stenosis candidates/localization | Implemented | Full + focused XAI tests | Historical | Mask R-CNN hash locked | Development evaluated | Independent localization reference | PARTIAL |
| 2D MLD/RVD and narrowing | Experimental | Synthetic and saved-run tests | Historical | Run-bound | Research only | Calibrated QCA/qualified references | PARTIAL |
| Research severity | Implemented with abstention | Protocol/export tests | Historical | Snapshot bound | Experimental | Independent severity agreement | PARTIAL |
| 3D segmentation/viewer | Implemented | Volume regression | Historical | Saved model output | Engineering verified | Fresh browser journey | PARTIAL |
| 3D measurement/severity | Bilateral local v5 | Synthetic anisotropic narrowing/taper/sensitivity | Historical | Source-grid bound | Experimental | Statistical uncertainty and CTA reference | PARTIAL |
| DICOM/NIfTI intake | Implemented | Automated input tests | Fresh journey not run | Parser/geometry receipts | Engineering verified | Browser evidence files/hashes | PARTIAL |
| Explainability | Candidate Grad-CAM/activation | Candidate-bound: 1/3 complete perturbation pass | Candidate-aligned UI previously observed | Checkpoint bound | Faithfulness not established | Consistent perturbation + randomization acceptance | PARTIAL |
| Saved runs/reports | Implemented | Authorization and consistency tests | Fresh download not run | Immutable versioned snapshot | Engineering verified | Download/reopen reconciliation | PARTIAL |
| Roles/security | Implemented | API/RBAC tests | Not fully inventoried | Repository evidence | Software verified | Production security acceptance | PARTIAL |
| Full automated regression | Implemented | 326 backend + 20 frontend + build | N/A | Revision recorded | Software verified | Five opt-in checks skipped | PASS |
| Deployment | Prepared locally | Not deployed | NOT_TESTED | N/A | Postponed | Authorization and production architecture | BLOCKED |
| Independent clinical validation | N/A | No eligible evidence | N/A | Missing reference cohort | Not established | External clinical evidence/governance | BLOCKED |

## Final decision

The application is a defensible research software demonstration with strong automated evidence. Milestones 1–3 are **engineering-partial**, not clinically accepted. Final software demonstration acceptance remains **PARTIAL** until fresh browser journeys and export reconciliation pass.
