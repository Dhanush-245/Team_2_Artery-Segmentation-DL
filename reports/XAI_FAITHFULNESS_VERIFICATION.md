# XAI faithfulness verification — 17 November 2026

## Checkpoint-bound execution

- Model: retained Mask R-CNN stenosis detector.
- SHA-256: `f0bc898c95b6efdd53863d5a430fb4b850c2451b440c5a53b92a73e73c5be2e3`.
- Method: `instance_mask_constrained_detector_gradcam_v2`.
- Coordinate frame: `prepared_512_xy`.
- Candidate count: 3.
- Candidate support overlap: 1.0. This is descriptive and expected from the explicit candidate-mask constraint; it is not proof of causal faithfulness.

## Initial combined-target check

| Check | Result | Decision |
| --- | ---: | --- |
| Brightness perturbation Spearman stability | 0.9749058254 | PASS |
| Deletion AUC advantage | 0.5381666897 | PASS |
| Insertion AUC advantage | -0.0534580499 | FAIL |
| Isolated randomized-copy target | No eligible retained target | NOT_TESTED |

The randomized copy was kept isolated and no attribution image was fabricated when its target disappeared. No weights were changed.

## Target-binding investigation

The initial score function summed all retained detections, which allowed an unrelated instance to replace the candidate during perturbation. The insertion baseline was also an all-zero image. The diagnostic now binds each score to the original instance mask by IoU and uses the input's per-channel median baseline. Acceptance thresholds were not changed.

| Candidate | Original score | Deletion advantage | Insertion advantage | Result |
| --- | ---: | ---: | ---: | --- |
| 1 | 0.629106 | 0.252441 | -0.028444 | deletion PASS; insertion FAIL |
| 2 | 0.295525 | 0.000000 | -0.111665 | deletion FAIL; insertion FAIL |
| 3 | 0.258456 | 0.222643 | 0.129512 | deletion PASS; insertion PASS |

The disposable randomized model still produced no eligible spatially matched target, so randomization remains **NOT_TESTED**. Machine-readable evidence is `xai_checkpoint_verification_20261117.json`.

## Conclusion

The displayed map is candidate-aligned and checkpoint-bound, but predefined faithfulness acceptance is **not established** because results are inconsistent across candidates and model-randomization comparison was unavailable. Overall XAI scientific acceptance: **PARTIAL**. The UI must describe it as research saliency, not a clinical explanation.
