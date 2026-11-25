# Case reference metrics and 3D section navigation

Open a completed CTA run and choose **Model evaluation**. A doctor, clinician or administrator with case review access can attach a binary, source-aligned NIfTI reference. Provide provenance and confirm the exact study and target. Dice, IoU, HD95 and ASSD are calculated against the saved original prediction, retained as a new evaluation and included in subsequent JSON, CSV, PDF and evidence ZIP exports. Prior exported files remain unchanged.

The reference must match the saved source-grid prediction shape, affine and millimetre units, with finite labels 0 and 1. Uploads are bounded to 32 MiB and 96 million voxels; surface-distance processing is bounded to a 16 million voxel foreground bounding box. Incompatible masks are rejected without resampling. Empty-mask surface distances are undefined. Evaluation records are filtered by case, run, source hash and prediction hash, so an incompatible historical record cannot appear as a current score.

A reviewer-supplied reference does not establish independent clinical validation. Without an eligible reference the application states why case scores are unavailable. Aggregate validation benchmarks stay separate.

The 3D section controls focus and scroll to distinct visible targets. Candidates and Measurements explain when strict geometric eligibility is absent; exploratory path widths remain separately labelled. No quality threshold has been lowered to create a positive candidate.

Engineering regression coverage: physical-distance known-truth fixture, identity and geometry rejection, role authorization, retry, persistence, immutable prediction, stale-record exclusion and export consistency. Synthetic self-reference fixtures test software only.
