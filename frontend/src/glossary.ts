/** Plain-language definitions shown as hover/focus hints and in the glossary panel. */
export const GLOSSARY: Record<string, string> = {
  Dice: "Overlap between the predicted and reference masks: 2 × shared pixels ÷ (predicted + reference). 1 is a perfect match.",
  IoU: "Intersection over union: shared pixels ÷ all pixels in either mask. Stricter than Dice.",
  "Pixel accuracy": "Share of all pixels labelled correctly. Inflated by the large background, so read it with Dice.",
  Precision: "Of everything the model flagged, the share that was correct: TP ÷ (TP + FP).",
  Recall: "Of everything that should be found, the share the model found: TP ÷ (TP + FN). Also called sensitivity.",
  Sensitivity: "Same as recall: the share of true positives the model detected.",
  Specificity: "Of everything negative, the share correctly left unflagged: TN ÷ (TN + FP).",
  F1: "Harmonic mean of precision and recall; high only when both are high.",
  "AUC-ROC": "How well scores rank positives above negatives, from 0.5 (chance) to 1 (perfect).",
  "Hausdorff distance": "Largest distance between the predicted and reference boundaries; sensitive to single outliers.",
  HD95: "95th-percentile boundary distance: like Hausdorff, but ignores the worst 5% of points.",
  ASSD: "Average symmetric surface distance: the mean distance between the two boundaries.",
  MLD: "Minimum lumen diameter: the narrowest vessel width at a suspected stenosis.",
  RVD: "Reference vessel diameter: the expected healthy width near the narrowing.",
  "Narrowing %": "(RVD − MLD) ÷ RVD × 100. Research estimate from the predicted mask, not a validated QCA measurement.",
  Abstained: "The measurement failed a quality check (for example low edge contrast or an ambiguous branch), so no value is reported rather than a guess.",
  "Operating point": "The fixed score and mask thresholds the model uses to decide what counts as a detection.",
  "Grad-CAM": "Heatmap of the image regions that most increased the detector's score for a candidate.",
  "Grad-CAM++": "A Grad-CAM variant with sharper weighting when several regions support one prediction.",
  MPR: "Multiplanar reconstruction: viewing a 3D volume as slices in three directions.",
  "Window / level": "CT display contrast: the window is the range of Hounsfield units shown, the level is its centre.",
};

export const glossaryHint = (name: string) => GLOSSARY[name] ?? GLOSSARY[name.replace(/^(Lesion|Frame|Pixel) /, "")];
