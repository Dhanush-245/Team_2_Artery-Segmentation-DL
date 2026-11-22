# Stenosis detector — one-time protected test (22 Nov 2026)

The retained Mask R-CNN stenosis detector (checkpoint `f0bc898c…`, frozen R-01 configuration: score threshold 0.25,
pixel threshold 0.5) was scored once on the official ARCADE stenosis **test** split. The test split was not used for
training, threshold selection or any other decision. No weights changed. Full receipt: `receipt.json`.

| Metric (IoU ≥ 0.5 matching) | Validation (200 images, 20 Nov) | Protected test (300 images) |
|---|---|---|
| ARCADE official F1 | 0.439 | 0.396 |
| Instance precision | 0.346 | 0.245 |
| Instance recall | 0.480 | 0.547 |
| Instance F1 | 0.402 | 0.338 |
| TP / FP / FN | 195 / 369 / 211 | 211 / 650 / 175 |
| False positives per image | 1.85 | 2.17 |
| Pixel Dice (union mask, supplementary) | 0.571 | 0.537 |
| Pixel AUC-ROC (union score, supplementary) | 0.857 | 0.862 |
| Matched-instance Dice | — | 0.781 |

**Reading.** Performance on unseen test data is lower than on validation, mainly in precision: about 2.2 false
candidates per image, and about 1 in 4 candidates matches a reference lesion. Recall is slightly higher (55 %). These
are the numbers the application should quote for detector generalization. Pixel metrics are supplementary and are not
official ARCADE scoring.

**Scope.** One public dataset (ARCADE), one frozen checkpoint, one evaluation. Clinical validity is not assessed. Any
later model change needs a new held-out cohort; this test split is now spent for model selection.
