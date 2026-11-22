"""Shared, case-specific explainable-AI engine for saved 2D analysis runs.

One engine; one persisted record per (case, image, run, checkpoint, task, target, method,
method version, target definition, preprocessing, parameters). Every attribution is computed
on the frozen release checkpoint for the exact prepared image of the saved run.

Targets
- stenosis candidate Cn: the Mask R-CNN foreground score of the detection that re-identifies
  the saved candidate (mask IoU with the saved polygon). Never a global or summed score.
- segmentation 'vessel_mask': mean artery logit over the run's predicted vessel pixels
  (probability >= 0.5) of the frozen ResNet34 U-Net.

Methods
- gradcam: channel weights = mean gradient (Selvaraju et al.).
- gradcampp: second/third-order positive-gradient weights (Chattopadhay et al.), shared
  tested implementation in xai_methods.
- occlusion: per-cell drop of the same target when an 8x8 grid cell (64 px) is replaced by the
  per-channel image mean.
'constrained' maps multiply the candidate map by its predicted mask (location then follows the
mask; see M3-02). Research saliency only; not a clinical explanation.
"""
from __future__ import annotations

import hashlib
import json
import threading
from io import BytesIO
from pathlib import Path

import numpy as np

ENGINE_VERSION = 'corovision-xai-engine-v1'
METHOD_VERSIONS = {'gradcam': 'gradcam-v3', 'gradcampp': 'gradcampp-v3', 'occlusion': 'occlusion-grid8-mean-v1'}
TARGET_DEFINITION_VERSION = 'xai-targets-v1'
PREPROCESSING_VERSION = 'prepared_512_xy'
DETECTOR_LAYER = 'backbone.body.layer4'
SEGMENTATION_LAYER = 'd0'
OCCLUSION_GRID = 8
MATCH_IOU = 0.5
SEGMENTATION_TARGET = 'vessel_mask'
METHODS = {'stenosis': ('gradcam', 'gradcampp', 'occlusion'), 'segmentation': ('gradcam', 'gradcampp', 'occlusion')}
TARGET_DEFINITIONS = {
    'stenosis': 'Mask R-CNN foreground score of the detection re-identified as the saved candidate '
                '(mask IoU >= 0.5 with the saved polygon); explained at backbone.body.layer4',
    'segmentation': 'Mean artery logit over the run-predicted vessel pixels (probability >= 0.5) of the '
                    'ResNet34 U-Net; explained at decoder block d0',
}
GENERATION_LOCK = threading.Lock()


def identity(**fields) -> str:
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()


def _polygon_mask(polygon, shape=(512, 512)) -> np.ndarray:
    from PIL import Image, ImageDraw
    points = [(float(x), float(y)) for x, y in polygon]
    if len(points) < 3:
        raise ValueError('Candidate polygon is incomplete')
    canvas = Image.new('L', (shape[1], shape[0]), 0)
    ImageDraw.Draw(canvas).polygon(points, fill=1)
    return np.asarray(canvas, dtype=bool)


def _normalize(values: np.ndarray) -> np.ndarray:
    values = np.nan_to_num(np.asarray(values, dtype=np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    values = np.clip(values, 0, None)
    top = float(values.max())
    return values / top if top > 0 else values


def _load_inputs(prepared: Path):
    from PIL import Image
    with Image.open(prepared) as opened:
        rgb = opened.convert('RGB')
        if rgb.size != (512, 512):
            raise ValueError('Explanations require the saved 512x512 prepared image')
        color = np.asarray(rgb, dtype=np.float32) / 255.
    gray = np.asarray(Image.fromarray(np.uint8(color * 255)).convert('L'), dtype=np.float32) / 255.
    return color, gray


def _models():
    from . import trained_release as tr
    return tr._models(str(tr.artifact_root()))


def _cam(activation, gradient, method, size):
    import torch.nn.functional as F
    from .xai_methods import gradcam_plus_plus_weights, gradcam_weights, weighted_cam
    weights = gradcam_weights(gradient) if method == 'gradcam' else gradcam_plus_plus_weights(activation, gradient)
    cam = weighted_cam(activation, weights)
    cam = F.interpolate(cam, size=size, mode='bilinear', align_corners=False)[0, 0]
    # Same min-max normalization as the production saved maps (trained_release._detector_explanations).
    cam = cam - cam.min()
    cam = cam / cam.max().clamp_min(1e-8)
    return cam.detach().cpu().numpy()


def _detector_target(model, image_chw, reference_mask, threshold):
    """Run the frozen detector once and return (output, index, iou) for the saved candidate."""
    import torch
    output = model([image_chw])[0]
    keep = torch.where((output['labels'] == 1) & (output['scores'] >= float(threshold)))[0]
    best, best_iou = None, 0.0
    reference = torch.as_tensor(reference_mask)
    for index in keep.tolist():
        mask = output['masks'][index, 0].detach() >= .5
        union = int((mask | reference).sum())
        iou = int((mask & reference).sum()) / union if union else 0.0
        if iou > best_iou:
            best, best_iou = index, iou
    if best is None or best_iou < MATCH_IOU:
        return output, None, best_iou
    return output, best, best_iou


def stenosis_attribution(prepared: Path, candidate: dict, method: str, threshold: float) -> tuple[np.ndarray, dict]:
    import torch
    color, _ = _load_inputs(prepared)
    reference = _polygon_mask(candidate['polygon_prepared_xy'])
    _, detector = _models()
    image = torch.from_numpy(color.transpose(2, 0, 1).copy())
    if method == 'occlusion':
        return _detector_occlusion(detector, color, reference, threshold)
    captured = {}
    layer = detector.backbone.body.layer4

    def hook(_module, _inputs, output):
        captured['activation'] = output
        output.register_hook(lambda gradient: captured.__setitem__('gradient', gradient))

    handle = layer.register_forward_hook(hook)
    try:
        detector.zero_grad(set_to_none=True)
        with torch.enable_grad():
            output, index, iou = _detector_target(detector, image.requires_grad_(True), reference, threshold)
            if index is None:
                raise LookupError(f'The saved candidate could not be re-identified on the frozen detector (best IoU {iou:.2f})')
            output['scores'][index].backward()
        cam = _cam(captured['activation'], captured['gradient'], method, (512, 512))
        mask = (output['masks'][index, 0].detach().cpu().numpy() >= .5)
        return cam, dict(target_score=float(output['scores'][index].detach()), match_iou=round(iou, 4),
                         target_layer=DETECTOR_LAYER, predicted_mask=mask)
    finally:
        handle.remove()
        detector.zero_grad(set_to_none=True)


def _detector_occlusion(detector, color, reference, threshold):
    import torch
    from .xai_faithfulness import matched_instance_score

    def score(values):
        with torch.inference_mode():
            output = detector([torch.from_numpy(np.ascontiguousarray(values.transpose(2, 0, 1)))])[0]
        return matched_instance_score(output, reference, minimum_iou=MATCH_IOU)

    base = score(color)
    if base <= 0:
        raise LookupError('The saved candidate could not be re-identified on the frozen detector')
    heat = _occlude(color, score, base)
    return heat, dict(target_score=base, match_iou=None, target_layer='input (occlusion)', predicted_mask=None)


def _occlude(color, score, base):
    cell = 512 // OCCLUSION_GRID
    fill = color.reshape(-1, 3).mean(0)
    heat = np.zeros((512, 512), np.float32)
    for row in range(OCCLUSION_GRID):
        for col in range(OCCLUSION_GRID):
            occluded = color.copy()
            occluded[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell] = fill
            heat[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell] = max(0.0, base - score(occluded))
    return heat


def segmentation_attribution(prepared: Path, method: str) -> tuple[np.ndarray, dict]:
    import torch
    _, gray = _load_inputs(prepared)
    artery, _ = _models()
    tensor = torch.from_numpy(gray.copy())[None, None]
    with torch.inference_mode():
        roi = (artery(tensor).sigmoid()[0, 0] >= .5).numpy()
    if not roi.any():
        raise LookupError('The frozen segmentation model predicts no vessel pixels for this image')
    roi_t = torch.from_numpy(roi)
    if method == 'occlusion':
        def score(values):
            with torch.inference_mode():
                return float(artery(torch.from_numpy(np.ascontiguousarray(values[..., 0]))[None, None])[0, 0][roi_t].mean())
        rgb = np.repeat(gray[..., None], 3, axis=2)
        base = score(rgb)
        if not np.isfinite(base):
            raise ValueError('Segmentation target is not finite')
        heat = _occlude(rgb, score, base)
        return heat, dict(target_score=base, roi_pixels=int(roi.sum()), target_layer='input (occlusion)', predicted_mask=roi)
    captured = {}

    def hook(_module, _inputs, output):
        captured['activation'] = output
        output.register_hook(lambda gradient: captured.__setitem__('gradient', gradient))

    handle = artery.d0.register_forward_hook(hook)
    try:
        artery.zero_grad(set_to_none=True)
        with torch.enable_grad():
            target = artery(tensor.requires_grad_(True))[0, 0][roi_t].mean()
            target.backward()
        cam = _cam(captured['activation'], captured['gradient'], method, (512, 512))
        return cam, dict(target_score=float(target.detach()), roi_pixels=int(roi.sum()),
                         target_layer=SEGMENTATION_LAYER, predicted_mask=roi)
    finally:
        handle.remove()
        artery.zero_grad(set_to_none=True)


def heatmap_png(values: np.ndarray) -> bytes:
    """RGBA heatmap: perceptual 'hot' ramp, alpha follows attribution (0 stays transparent)."""
    from PIL import Image
    v = np.clip(values, 0, 1)
    rgb = np.stack((np.minimum(1, v * 2), np.clip(v * 2 - .65, 0, 1), np.clip(v * 3 - 2, 0, 1)), -1)
    rgba = np.concatenate([rgb, np.clip(v * 1.4, 0, 1)[..., None]], -1)
    buffer = BytesIO()
    Image.fromarray(np.uint8(rgba * 255)).save(buffer, 'PNG')
    return buffer.getvalue()


def overlay_png(prepared: Path, values: np.ndarray) -> bytes:
    from .analysis_model import heatmap_overlay_png
    return heatmap_overlay_png(prepared, values)


def map_png(values: np.ndarray) -> bytes:
    from PIL import Image
    buffer = BytesIO()
    Image.fromarray(np.uint8(np.clip(values, 0, 1) * 255)).save(buffer, 'PNG')
    return buffer.getvalue()


def verify(prepared: Path, task: str, values: np.ndarray, candidate: dict | None, threshold: float) -> dict:
    """Deletion/insertion against an equal-area random order for this exact target (protocol v1)."""
    import torch
    from .xai_faithfulness import evaluate_forward_occlusion, matched_instance_score
    color, gray = _load_inputs(prepared)
    artery, detector = _models()
    if task == 'stenosis':
        reference = _polygon_mask(candidate['polygon_prepared_xy'])

        def score(chw):
            with torch.inference_mode():
                output = detector([torch.from_numpy(np.ascontiguousarray(chw, dtype=np.float32))])[0]
            return matched_instance_score(output, reference, minimum_iou=MATCH_IOU)
        image = color.transpose(2, 0, 1).copy()
        baseline = image.reshape(3, -1).mean(1)[:, None, None]
    else:
        tensor = torch.from_numpy(gray.copy())[None, None]
        with torch.inference_mode():
            roi = torch.from_numpy((artery(tensor).sigmoid()[0, 0] >= .5).numpy())

        def score(values2d):
            with torch.inference_mode():
                return float(artery(torch.from_numpy(np.ascontiguousarray(values2d, dtype=np.float32))[None, None])[0, 0][roi].mean())
        image = gray.copy()
        baseline = float(gray.mean())
    result = evaluate_forward_occlusion(image, values, score, grid=OCCLUSION_GRID, baseline_value=baseline)
    gates = result['gates']
    return dict(protocol=result['protocol'], metrics=result['metrics'], grid=result['grid'], seed=result['seed'],
                baseline='per-channel image mean',
                deletion='PASS' if gates['deletion'] else 'FAIL',
                insertion='PASS' if gates['insertion'] else 'FAIL',
                randomization='NOT_TESTED',
                randomization_note='Per-target model randomization is not run here; see the study-level M3-02 result.')


def summarize(values: np.ndarray, reference: np.ndarray | None) -> dict:
    energy = float(values.sum())
    result = dict(max=float(values.max()), mean=float(values.mean()), nonzero_fraction=float((values > 0.05).mean()))
    if reference is not None and energy > 0:
        result['energy_inside_target_mask'] = round(float(values[reference].sum()) / energy, 4)
        peak = np.unravel_index(int(values.argmax()), values.shape)
        result['peak_inside_target_mask'] = bool(reference[peak])
    return result
