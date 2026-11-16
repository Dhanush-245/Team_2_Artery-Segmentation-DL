# 3D measurement validation — 17 November 2026

## Verified engineering behavior

- Native spacing, affine and source-grid geometry are retained.
- Perpendicular cross-sections, diameter-equivalent and area narrowing are tested with known-truth synthetic geometry.
- Empty, boundary-clipped, truncated and disconnected masks do not create invented vessel connections.
- Component identity, branch/border exclusions, tangent direction and anisotropic voxels have regression coverage.
- Unsupported or unstable geometry produces an abstention reason.

## Current method boundary

The saved implementation still uses an experimental path-interior percentile reference. It is not a validated local proximal/distal CTA reference, uncertainty is not statistically quantified, and a grade may only be displayed when existing eligibility gates pass. The method must remain labelled experimental mask geometry.

## Result

Synthetic geometry and software handling: **PASS**. Geometry-aware local reference selection, taper-aware bilateral reference suitability, repeatability/sensitivity criteria, and independent native-resolution CTA comparison: **PARTIAL/BLOCKED**. No clinical diameter-accuracy claim is supported.
