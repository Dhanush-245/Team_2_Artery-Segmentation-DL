"""Recheck the saved source, without claiming original DICOM-series validation."""
import hashlib
from datetime import datetime, timezone

import nibabel as nib
import numpy as np

from .volume_inference import inspect_input


def validate_saved_source(source, mask, expected_sha):
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected_sha:
        raise ValueError('Saved source hash differs from this analysis run')
    image = inspect_input(source)
    prediction = nib.load(mask)
    if image.shape != prediction.shape or not np.allclose(image.affine, prediction.affine, rtol=0, atol=1e-4):
        raise ValueError('Saved source and prediction grids do not match')
    return dict(status='checked', scope='saved_source_grid', checked_at=datetime.now(timezone.utc).isoformat(),
                source_sha256=expected_sha, shape=list(image.shape),
                detail='Saved NIfTI source hash, scalar 3D header, payload bounds, millimetre units and finite invertible affine checked; prediction shape and affine match. Original DICOM series identity and slice ordering are not established by this saved-NIfTI check.')
