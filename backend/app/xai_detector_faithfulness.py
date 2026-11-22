"""Detector-bound helpers for Grad-CAM / Grad-CAM++ faithfulness sanity checks.

These helpers bind attributions and perturbation scores to the *same* retained
Mask R-CNN candidates that produced the saved explanation maps.  The frozen
model is never modified: weight randomization always acts on a deep copy.
Results are research diagnostics, not clinical validation.
"""
import copy
import zlib

import numpy as np

from .xai_faithfulness import matched_instance_index
from .xai_methods import gradcam_plus_plus_weights, gradcam_weights, weighted_cam

TARGET_LAYER = 'backbone.body.layer4'
FOREGROUND_LABEL = 1
MASK_THRESHOLD = 0.5
MATCH_MINIMUM_IOU = 0.1

# Cascading randomization from the output end towards the input (Adebayo et al. 2018).
CASCADE_STAGES = (
    ('roi_predictors', ('roi_heads.box_predictor', 'roi_heads.mask_predictor')),
    ('roi_heads', ('roi_heads',)),
    ('rpn', ('rpn',)),
    ('fpn', ('backbone.fpn',)),
    ('layer4', ('backbone.body.layer4',)),
    ('layer3', ('backbone.body.layer3',)),
    ('layer2', ('backbone.body.layer2',)),
    ('layer1_and_stem', ('backbone.body.layer1', 'backbone.body.conv1', 'backbone.body.bn1')),
)


def retained_candidates(output, score_threshold):
    """Binary masks and scores of foreground detections kept at the saved operating point."""
    import torch

    keep = torch.where((output['labels'] == FOREGROUND_LABEL) & (output['scores'] >= float(score_threshold)))[0]
    masks = (output['masks'][keep, 0] >= MASK_THRESHOLD).detach().cpu().numpy()
    scores = output['scores'][keep].detach().cpu().numpy().astype(float)
    return [{'output_index': int(index), 'score': float(score), 'mask': mask}
            for index, score, mask in zip(keep.tolist(), scores, masks)]


def candidate_score_fn(model, candidate_masks):
    """Score = mean matched raw score of the original candidates (0 when a candidate is lost)."""
    import torch

    if not candidate_masks:
        raise ValueError('At least one retained candidate mask is required')

    def score(image_chw):
        tensor = torch.as_tensor(np.ascontiguousarray(image_chw), dtype=torch.float32)
        with torch.inference_mode():
            output = model([tensor])[0]
        values = []
        for mask in candidate_masks:
            index = matched_instance_index(output, mask, label=FOREGROUND_LABEL, minimum_iou=MATCH_MINIMUM_IOU)
            values.append(0.0 if index is None else float(output['scores'][index]))
        return float(np.mean(values))

    return score


def _normalize(value):
    value = value - value.min()
    return value / value.max().clamp_min(1e-8)


def detector_cams(model, image_chw, candidate_masks, *, fallback_to_top=False):
    """Grad-CAM and Grad-CAM++ for the detections matching ``candidate_masks``.

    Returns raw (unconstrained) and mask-constrained maps combined by the
    per-pixel maximum over candidates, each normalized to 0..1 in the input
    frame, plus the target binding used.  The constrained form follows the
    saved-map contract of ``trained_release._detector_explanations``; the
    matched model's own candidate mask is used for the constraint.  With
    ``fallback_to_top`` (randomized disposable models only) an unmatched
    target falls back to the highest-scoring foreground detection.
    """
    import torch
    import torch.nn.functional as F

    layer = model.get_submodule(TARGET_LAYER)
    captured = {}

    def capture(_module, _inputs, output):
        captured['activation'] = output
        output.register_hook(lambda gradient: captured.__setitem__('gradient', gradient))

    image = torch.as_tensor(np.ascontiguousarray(image_chw), dtype=torch.float32)
    size = tuple(image.shape[-2:])
    handle = layer.register_forward_hook(capture)
    maps = {'gradcam_raw': [], 'gradcam_constrained': [], 'gradcampp_raw': [], 'gradcampp_constrained': []}
    matched = 0
    binding = 'no_target'
    try:
        model.zero_grad(set_to_none=True)
        with torch.enable_grad():
            output = model([image.clone().requires_grad_(True)])[0]
            indices = [matched_instance_index(output, mask, label=FOREGROUND_LABEL, minimum_iou=MATCH_MINIMUM_IOU)
                       for mask in candidate_masks]
            indices = [index for index in indices if index is not None]
            binding = 'matched_original_candidates'
            if not indices and fallback_to_top:
                foreground = torch.where(output['labels'] == FOREGROUND_LABEL)[0]
                if foreground.numel():
                    indices = [int(foreground[torch.argmax(output['scores'][foreground])])]
                    binding = 'top_foreground_detection_fallback'
            activation = captured.get('activation')
            for position, index in enumerate(indices):
                model.zero_grad(set_to_none=True)
                captured.pop('gradient', None)
                output['scores'][index].backward(retain_graph=position < len(indices) - 1)
                gradient = captured.get('gradient')
                if gradient is None or activation is None:
                    continue
                matched += 1
                mask = F.interpolate(output['masks'][index:index + 1], size=size, mode='bilinear',
                                     align_corners=False)[0, 0].detach() >= MASK_THRESHOLD
                for name, weights in (('gradcam', gradcam_weights(gradient)),
                                      ('gradcampp', gradcam_plus_plus_weights(activation, gradient))):
                    cam = F.interpolate(weighted_cam(activation, weights), size=size, mode='bilinear',
                                        align_corners=False)[0, 0].detach()
                    cam = _normalize(cam)
                    maps[name + '_raw'].append(cam)
                    maps[name + '_constrained'].append(cam * mask)
    finally:
        handle.remove()
        model.zero_grad(set_to_none=True)
    combined = {name: (_normalize(torch.stack(values).amax(dim=0)).cpu().numpy() if values else None)
                for name, values in maps.items()}
    return combined, {'targets': matched, 'binding': binding if matched else 'no_target'}


def _reset_module(module, generator_seed):
    import torch
    from torchvision.ops.misc import FrozenBatchNorm2d

    torch.manual_seed(generator_seed)
    for layer in module.modules():
        if isinstance(layer, FrozenBatchNorm2d):
            layer.weight.fill_(1.0)
            layer.bias.zero_()
            layer.running_mean.zero_()
            layer.running_var.fill_(1.0)
        elif hasattr(layer, 'reset_parameters'):
            layer.reset_parameters()


def randomized_copy(model, module_names, *, seed, score_thresh=None):
    """Deep copy of ``model`` with the named submodules re-initialized; the input is untouched."""
    import torch

    disposable = copy.deepcopy(model)
    if score_thresh is not None:
        disposable.roi_heads.score_thresh = float(score_thresh)
    with torch.no_grad():
        for name in module_names:
            # Per-name seeds keep a layer's random weights identical across cascade stages.
            _reset_module(disposable.get_submodule(name), seed + zlib.crc32(name.encode()))
    return disposable.eval()


def cascading_randomized_models(model, *, seed, stages=CASCADE_STAGES, score_thresh=0.0):
    """Yield (stage_name, cumulative_module_names, disposable_model) from output to input."""
    names = []
    for stage, modules in stages:
        names.extend(modules)
        yield stage, tuple(names), randomized_copy(model, names, seed=seed, score_thresh=score_thresh)
