# Demonstration and evidence policy

CoroVision AI separates software demonstration from scientific and clinical validation.

## Evidence classes

- `PRESERVED_MODEL_EVIDENCE`: an immutable result previously produced by a model workflow.
- `LIVE_FROZEN_INFERENCE`: a run produced by a registered, unchanged checkpoint.
- `SYNTHETIC_KNOWN_TRUTH`: a controlled mathematical fixture with declared expected behavior.
- `SOFTWARE_INTEGRATION_TEST`: an isolated API, persistence, viewer or export test.
- `BROWSER_VERIFIED`: an actual browser journey with recorded artifacts.
- `EXPLORATORY_RESEARCH_ESTIMATE`: an algorithmic result that lacks qualified independent validation.
- `EXTERNAL_REFERENCE_EVALUATION`: an eligible evaluation against a documented external reference. This label is not used unless the reference and independence criteria are met.

Evidence class and scientific-validation status are independent fields. Passing a synthetic fixture establishes software behavior only.

## Current demonstration coverage

The authenticated **Demonstration & Verification** workspace executes the application’s actual diameter-reduction, research-severity and 3D mask-geometry functions. It currently verifies:

- exact no-narrowing and 25%, 50% and 70% severity boundaries;
- uncertainty-driven withholding at a category boundary;
- a connected synthetic 3D tube accepted for research geometry;
- a fragmented synthetic 3D tube correctly abstained.

The downloadable JSON manifest contains expected outputs, actual outputs, outcomes and a SHA-256 identity. Synthetic masks are never labelled as model predictions.

## Claim rules

- Saved patient-image assessments retain their own quality outcome. Synthetic success never replaces an abstained saved result.
- Genuine 2D images remain in source pixels unless acquisition-specific calibration is verified.
- A fragmented 3D prediction remains fragmented and its measurement warnings remain visible.
- Browser evidence is recorded only after execution in an actual browser; API tests are not relabelled as browser acceptance.
- Training and checkpoint promotion remain disabled unless separately authorized.

## Remaining external evidence

Independent patient-level evaluation, qualified MLD/RVD references, expert severity agreement and clinical validation are not established. These are scientific limitations, not blockers to deterministic software demonstrations.
