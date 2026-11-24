# 3D coronary CTA case workspace

Research use only. One page per 3D case; every block reads the same case, source volume and saved run. A sticky bar jumps between the twelve sections: Overview, Source & preprocessing, 3D & MPR viewer, Segmentation, Vessel analysis & CPR, Stenosis candidates, Measurements, Severity, Explainable AI, Model evaluation, Review & history, Reports & exports.

## Linked viewer
- Four panels: axial, coronal, sagittal and the 3D vessel surface, with one shared crosshair. Click a slice to place it; the other planes and a yellow ring on the 3D surface follow.
- Scroll or arrow keys (Shift = 10) change slice; zoom buttons and drag pan; double-click recentres a panel; full-screen button; shared window/level presets, mask and attribution opacity. A "Single plane" layout keeps the earlier one-plane viewer.
- Voxel and world (RAS mm) readout. `GET /api/cases/{case}/volumes/analyses/{run}/locate` converts between voxel indices and world coordinates using the saved source-grid affine.
- "Show in views" on a candidate, a per-path narrowest point or a predicted component moves all views (and the curved-reformation path) to that place.
- Slices are rendered on demand from the saved full-resolution source; the decoded volume is cached per study, so scrolling takes milliseconds after the first slice.

## Reviewer mask corrections (versions)
Doctors, clinicians and administrators with review access can exclude predicted connected components (for example a fragment outside the heart) and save the result as a new version: `volumes/{run}/mask_review/v{n}.nii.gz` plus a JSON record (reviewer role, time, note, excluded components, original and edited mask hashes). Reviewers can also position the MPR crosshair and queue single-voxel paint or erase edits. Versions are always computed from the model's original mask, which is never overwritten; exported reports and saved measurements are unchanged. A version can be shown in the slice views and downloaded as NIfTI, and the evidence ZIP lists the records (`mask_review.json`). The 3D surface and measurements still use the original mask. API: `/api/cases/{case}/volumes/analyses/{run}/mask-review` (GET list, POST new version, GET `/versions/{n}/mask.nii.gz`); `mpr.png` accepts `mask_version`.

## Limits
Not a clinical tool; geometric candidates are experimental; 3D Grad-CAM faithfulness did not pass; no independent CTA validation or expert references. Voxel painting is performed one source-grid voxel at a time.
