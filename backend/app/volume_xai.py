"""Volumetric attribution for saved 3D CTA runs of the retained ImageCAS 3D U-Net.

Target: mean foreground-minus-background logit over the voxels the model labels as vessel
(argmax) in its 128^3 input grid, i.e. a defined segmentation output region.
Methods: 3D Grad-CAM and Grad-CAM++ at decoder block dec[1] (24 channels, 64^3), trilinearly
upsampled to 128^3; 3D occlusion sensitivity on a 4x4x4 block grid.
The attribution is restored to the native source grid with the same coarse affine and
resample_from_to path used for the saved vessel mask, and the alignment is checked by
re-deriving that mask and comparing it with the saved mask_source.nii.gz.
Research saliency only.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np

METHOD_VERSIONS = {'gradcam': 'gradcam3d-v1', 'gradcampp': 'gradcampp3d-v1', 'occlusion': 'occlusion3d-grid4-mean-v1'}
TARGET_LAYER = 'dec[1]'
TARGET_ID = 'vessel_mask'
TARGET_DEFINITION = ('Mean vessel-minus-background logit over the voxels the 3D U-Net labels as vessel in its '
                     '128^3 input grid; explained at decoder block dec[1] (64^3)')
GRID = 4
SEED = 20261122


def load_model(checkpoint: Path, expected_sha: str):
    import torch
    from .volume_inference import build_model
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != expected_sha:
        raise ValueError('3D checkpoint checksum differs from the run; no other model is substituted')
    blob = torch.load(checkpoint, map_location='cpu', weights_only=True)
    model = build_model()
    model.load_state_dict(blob['model'], strict=True)
    return model.eval()


def _target(logits, roi):
    return (logits[0, 1] - logits[0, 0])[roi].mean()


def _normalize(values):
    values = np.nan_to_num(np.asarray(values, dtype=np.float32))
    values = values - values.min()
    top = float(values.max())
    return values / top if top > 0 else values


def attribution(source: Path, model, method: str):
    """Return (coarse 128^3 attribution in [0, 1], coarse vessel mask, prepared input, metadata)."""
    import torch
    import torch.nn.functional as F
    from .volume_inference import prepare_input
    from .xai_methods import gradcam_plus_plus_weights, gradcam_weights, weighted_cam
    image, canonical, prepared, coarse_affine = prepare_input(source)
    x = torch.from_numpy(prepared)[None, None]
    with torch.no_grad():  # not inference_mode: the mask indexes a tensor tracked by autograd below
        logits = model(x)
        roi = (logits.argmax(1)[0] == 1)
    if not bool(roi.any()):
        raise LookupError('The 3D model labels no vessel voxels in this volume')
    meta = dict(roi_voxels=int(roi.sum()), coarse_affine=coarse_affine, image=image)
    if method == 'occlusion':
        def score(values):
            with torch.inference_mode():
                return float(_target(model(torch.from_numpy(values)[None, None]), roi))
        base = score(prepared)
        heat = np.zeros_like(prepared)
        cell = 128 // GRID
        fill = float(prepared.mean())
        for i in range(GRID):
            for j in range(GRID):
                for k in range(GRID):
                    block = (slice(i * cell, (i + 1) * cell), slice(j * cell, (j + 1) * cell), slice(k * cell, (k + 1) * cell))
                    occluded = prepared.copy()
                    occluded[block] = fill
                    heat[block] = max(0.0, base - score(occluded))
        return _normalize(heat), roi.numpy(), prepared, dict(meta, target_score=base, target_layer='input (occlusion)')
    captured = {}
    layer = model.dec[1]

    def hook(_module, _inputs, output):
        captured['activation'] = output
        output.register_hook(lambda gradient: captured.__setitem__('gradient', gradient))

    handle = layer.register_forward_hook(hook)
    try:
        model.zero_grad(set_to_none=True)
        with torch.enable_grad():
            target = _target(model(x.clone().requires_grad_(True)), roi)
            target.backward()
        activation, gradient = captured['activation'], captured['gradient']
        weights = gradcam_weights(gradient) if method == 'gradcam' else gradcam_plus_plus_weights(activation, gradient)
        cam = F.interpolate(weighted_cam(activation, weights), size=(128, 128, 128), mode='trilinear', align_corners=False)[0, 0]
        cam = cam.detach().numpy()
        if not np.isfinite(cam).all():
            raise ValueError('Attribution contains non-finite values')
        return _normalize(cam), roi.numpy(), prepared, dict(meta, target_score=float(target.detach()), target_layer=TARGET_LAYER)
    finally:
        handle.remove()
        model.zero_grad(set_to_none=True)


def to_native(values: np.ndarray, coarse_affine, image, order: int):
    """Resample a 128^3 coarse array onto the saved source grid exactly as the vessel mask is."""
    import nibabel as nib
    from nibabel.processing import resample_from_to
    coarse = nib.Nifti1Image(values.astype(np.float32 if order else np.uint8), coarse_affine)
    restored = resample_from_to(coarse, (image.shape, image.affine), order=order, mode='nearest')
    return np.asarray(restored.dataobj)


def alignment(roi: np.ndarray, coarse_affine, image, saved_mask: Path) -> dict:
    """Re-derive the native-grid mask through the same transform and compare it with the saved mask."""
    import nibabel as nib
    restored = to_native(roi.astype(np.uint8), coarse_affine, image, order=0) > 0
    saved = nib.load(str(saved_mask))
    if saved.shape != image.shape or not np.allclose(saved.affine, image.affine, atol=1e-5):
        return dict(status='FAIL', reason='Saved mask geometry differs from the source')
    saved_values = np.asarray(saved.dataobj) > 0
    union = int((restored | saved_values).sum())
    dice = 2 * int((restored & saved_values).sum()) / (int(restored.sum()) + int(saved_values.sum())) if union else 1.0
    return dict(status='PASS' if dice >= 0.999 else 'FAIL', mask_dice_vs_saved=round(dice, 6),
                native_shape=list(image.shape), check='re-derived model mask vs saved mask_source.nii.gz, same affine path')


def save_native(values: np.ndarray, coarse_affine, image, path: Path) -> str:
    import nibabel as nib
    native = to_native(values, coarse_affine, image, order=1)
    scaled = np.uint8(np.clip(native, 0, 1) * 255)
    result = nib.Nifti1Image(scaled, image.affine)
    result.header.set_xyzt_units('mm')
    nib.save(result, str(path))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summarize(values: np.ndarray, roi: np.ndarray) -> dict:
    energy = float(values.sum())
    peak = np.unravel_index(int(values.argmax()), values.shape)
    return dict(max=float(values.max()), energy_inside_target_mask=round(float(values[roi].sum()) / energy, 4) if energy else None,
                peak_inside_target_mask=bool(roi[peak]), roi_voxels=int(roi.sum()))


def verify(model, prepared: np.ndarray, roi: np.ndarray, values: np.ndarray) -> dict:
    """3D deletion/insertion: 4x4x4 blocks ranked by mean attribution vs one fixed random order.

    Scores are the target divided by its unperturbed value so the 0.01 advantage gates match the 2D protocol.
    """
    import torch
    from .xai_faithfulness import PROTOCOL
    roi_t = torch.from_numpy(roi)

    def score(volume):
        with torch.inference_mode():
            return float(_target(model(torch.from_numpy(np.ascontiguousarray(volume))[None, None]), roi_t))
    base = score(prepared)
    if not base:
        raise ValueError('Unperturbed target is zero')
    cell = 128 // GRID
    blocks = [(slice(i * cell, (i + 1) * cell), slice(j * cell, (j + 1) * cell), slice(k * cell, (k + 1) * cell))
              for i in range(GRID) for j in range(GRID) for k in range(GRID)]
    importance = np.array([float(values[b].mean()) for b in blocks])
    fill = np.full_like(prepared, float(prepared.mean()))

    def curves(order):
        deleted, inserted = prepared.copy(), fill.copy()
        deletion, insertion = [score(deleted) / base], [score(inserted) / base]
        for index in order:
            block = blocks[int(index)]
            deleted[block] = fill[block]
            inserted[block] = prepared[block]
            deletion.append(score(deleted) / base)
            insertion.append(score(inserted) / base)
        return deletion, insertion

    auc = lambda v: float(np.trapezoid(v, dx=1 / (len(v) - 1)))  # noqa: E731
    rd, ri = curves(np.argsort(importance)[::-1])
    xd, xi = curves(np.random.default_rng(SEED).permutation(len(blocks)))
    metrics = dict(ranked_deletion_auc=auc(rd), random_deletion_auc=auc(xd), ranked_insertion_auc=auc(ri), random_insertion_auc=auc(xi))
    metrics['deletion_auc_advantage'] = metrics['random_deletion_auc'] - metrics['ranked_deletion_auc']
    metrics['insertion_auc_advantage'] = metrics['ranked_insertion_auc'] - metrics['random_insertion_auc']
    return dict(protocol=dict(PROTOCOL, id='corovision-forward-occlusion-3d-v1', grid=f'{GRID}x{GRID}x{GRID}',
                              baseline='volume mean', score='target / unperturbed target'),
                metrics=metrics, seed=SEED,
                deletion='PASS' if metrics['deletion_auc_advantage'] >= PROTOCOL['deletion_auc_advantage_min'] else 'FAIL',
                insertion='PASS' if metrics['insertion_auc_advantage'] >= PROTOCOL['insertion_auc_advantage_min'] else 'FAIL',
                randomization='NOT_TESTED',
                randomization_note='Model randomization is not run for the 3D model.')
