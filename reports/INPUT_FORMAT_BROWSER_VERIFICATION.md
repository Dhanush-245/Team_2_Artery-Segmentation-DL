# Input-format and browser verification — 17 November 2026

## Automated support

| Workflow | Evidence | Result |
| --- | --- | --- |
| 2D PNG/JPEG | Decode, size, dimension and non-finite validation tests | PASS |
| 2D XA DICOM | Modality/frame/pixel-spacing/PHI checks | PASS where eligible |
| Corrupt/unsupported/invalid 2D | Explicit rejection tests | PASS |
| 3D DICOM series | Ordering, one-series identity, spacing/orientation and payload limits | PASS |
| Mixed series/patient | Rejected rather than merged | PASS |
| Missing/irregular spacing | Rejected or withheld with reason | PASS |
| NIfTI | Affine, orientation, spacing and millimetre-unit preservation | PASS |
| Oversized/corrupt volume | Explicit rejection | PASS |

The full backend suite passed 322 tests with five opt-in external/model checks skipped.

## Browser status

Historical browser evidence exists for saved 2D and 3D cases, but a fresh upload-to-inference-to-reopen sequence was not completed in this closeout because connected browser control became unavailable. Exact local test files and a newly downloaded artifact set therefore cannot be asserted. Browser acceptance: **NOT_TESTED** for the fresh closeout journey, not FAIL.

## Remaining action

When browser control is available, run one eligible PNG/JPEG, one eligible XA DICOM, one complete CCTA DICOM series, and one NIfTI through upload, frozen inference, save, refresh/reopen, and export. Record hashes and case/image/run identifiers.
