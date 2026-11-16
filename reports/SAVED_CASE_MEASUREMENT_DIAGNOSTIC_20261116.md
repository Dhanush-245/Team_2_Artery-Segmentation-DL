# Saved-case measurement diagnostic — 16 November 2026

This record distinguishes accepted measurements from exploratory mask geometry for the preserved 2D analysis. It does not modify the saved run or any historical report.

## Immutable identities

- Case: `FINAL-2D-DEMO-20261113`
- Analysis run: `4157543d-5df7-482d-ba49-f354619a3b43`
- Current inspected assessment: `2790a31d4efa646e0f912f00192c4c75726df4fff532bbc326f4e93580ef3fa6`
- Assessment file SHA-256: `d8958755b07491ae17ec015db0dcaa642927257fa0a006a54c914c620ebd543d`
- Algorithm: `saved-run-source-cross-section-v4-mask-estimates`

## Candidate diagnostic ledger

| Candidate | Source mapping | Vessel association | Primary cross-section result | Exploratory mask estimate | Accepted narrowing | Accepted severity | Persistence | UI/report rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Saved original-coordinate candidate | Attempted on saved mask/path | Abstained: low local boundary contrast | MLD 7.21 px; RVD 8.49 px; 15.02%; minimal | Unavailable | Indeterminate | Immutable assessment retained | Show exploratory values only as supporting evidence; never as the primary grade |
| C2 | Saved original-coordinate candidate | Attempted on saved mask/path | Abstained: low local boundary contrast | MLD 8.25 px; RVD 10.00 px; 17.54%; minimal | Unavailable | Indeterminate | Immutable assessment retained | Show exploratory values only as supporting evidence; never as the primary grade |
| C3 | Saved original-coordinate candidate | Attempted on saved mask/path | Abstained: low local boundary contrast | MLD 7.21 px; RVD 10.00 px; 27.89%; mild | Unavailable | Indeterminate | Immutable assessment retained | Show exploratory values only as supporting evidence; never as the primary grade |

All three records contain `quality_status = exploratory_only_quality_gate_failed` and `eligible_for_reference_validation = false`. The current report resolver also inspects the nested cross-section abstention. Consequently, the PDF/CSV/JSON/ZIP primary findings must not expose the exploratory categories as accepted automatic severity.

## Root-cause decision

The saved run reached the measurement service; this is not a disconnected pipeline. Run identity, candidates, source-coordinate mapping, mask evidence and report persistence are present. The primary method stopped at its local boundary-contrast requirement. The fallback percentile/ring values are retained only to demonstrate what the predicted mask geometry contained.

The preserved source image does not provide enough local intensity separation at the sampled mask boundaries for the current quality-controlled method. No coordinate-transform defect was established in the inspected artifacts. Weakening this gate solely to produce grades would convert an exploratory estimate into unsupported evidence, so the abstention remains correct.

## Regression evidence

- `tests/test_research_report_integrity.py` verifies that exploratory values never become primary grades in PDF or CSV.
- `tests/test_automatic_measurement_pipeline.py` verifies a separate eligible known-truth saved run produces MLD, RVD, narrowing, sensitivity and Mild research severity.
- `tests/test_demonstrations.py` verifies the same source-grid geometry code produces 41.67% on an eligible 2D fixture and abstains on a low-contrast fixture.
- Full backend suite on 16 November 2026: 320 passed, 5 skipped.
- Frontend production build passed.

This establishes demonstration and software behavior. It does not establish clinical measurement accuracy.
