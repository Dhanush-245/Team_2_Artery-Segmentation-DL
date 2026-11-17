# 3D measurement validation — 17 November 2026

## Verified engineering behavior

- Native spacing, affine and source-grid geometry are retained.
- Perpendicular cross-sections, diameter-equivalent and area narrowing are tested with known-truth synthetic geometry.
- Empty, boundary-clipped, truncated and disconnected masks do not create invented vessel connections.
- Component identity, branch/border exclusions, tangent direction and anisotropic voxels have regression coverage.
- Unsupported or unstable geometry produces an abstention reason.

## Reliability increment

Method `lee-skeleton-local-bilateral-sections-v5` preserves the existing perpendicular-section sampler and adds:

- local proximal and distal same-path reference windows separated from the minimum;
- reference coefficient-of-variation and side-difference rejection;
- section sampling at 0.20, 0.25 and 0.30 mm;
- an explicit narrowing sensitivity range;
- severity withholding when that range crosses a 25/50/70 boundary;
- method-versioned caching so historical v4 results are not silently overwritten.

Known-truth anisotropic focal narrowing and taper-only fixtures were added. The focused 3D suite passed 23 tests with one opt-in skip.

## Result

Synthetic geometry, local references, taper rejection and step-size sensitivity: **PASS**. Statistical uncertainty, independent native-resolution CTA comparison and clinical reference suitability: **BLOCKED**. No clinical diameter-accuracy claim is supported.
