"""Per-target model-randomization check for one saved 2D explanation (Adebayo et al. 2018).

The saved map is compared with the map of the same method and form on two randomized deep copies of
the frozen model: the output head only, and the fully randomized model. The gate is the study-level
M3-02 gate: |Spearman rho| <= 0.2 against the fully randomized model. The frozen checkpoint is never
modified. Target binding on a randomized detector follows the study: the detection that matches the
saved candidate (mask IoU >= 0.1), else the declared fallback, its top-scoring foreground detection.
Occlusion maps are not checked here (each randomized model would need 64 more forward passes).
"""
from __future__ import annotations

import numpy as np

PROTOCOL = 'corovision-target-randomization-v1'
SEED = 20261122
GATE_ABS_SPEARMAN = 0.2
DETECTOR_STAGES = {'head': ('roi_heads.box_predictor', 'roi_heads.mask_predictor')}
SEGMENTATION_STAGES = {'head': ('head',), 'full': ('head', 'd0', 'd1', 'd2', 'd3', 'encoder')}
BINDING_IOU = 0.1


def _detector_full_names():
    from .xai_detector_faithfulness import CASCADE_STAGES
    return tuple(name for _, names in CASCADE_STAGES for name in names)


def _bind(output, reference):
    """Index of the detection matching the saved candidate, else the top-scoring foreground detection."""
    import torch
    foreground = torch.where(output['labels'] == 1)[0].tolist()
    if not foreground:
        return None, 'no_foreground_detection'
    target = torch.as_tensor(reference)
    best, best_iou = None, 0.0
    for index in foreground:
        mask = output['masks'][index, 0].detach() >= .5
        union = int((mask | target).sum())
        iou = int((mask & target).sum()) / union if union else 0.0
        if iou > best_iou:
            best, best_iou = index, iou
    if best is not None and best_iou >= BINDING_IOU:
        return best, 'matched_candidate'
    return max(foreground, key=lambda i: float(output['scores'][i])), 'top_detection_fallback'


def _detector_map(model, color, reference, method, constrained):
    import torch
    from .xai_engine import _cam
    captured = {}

    def hook(_module, _inputs, output):
        captured['activation'] = output
        output.register_hook(lambda gradient: captured.__setitem__('gradient', gradient))

    handle = model.backbone.body.layer4.register_forward_hook(hook)
    try:
        with torch.enable_grad():
            image = torch.from_numpy(color.transpose(2, 0, 1).copy()).requires_grad_(True)
            output = model([image])[0]
            index, binding = _bind(output, reference)
            if index is None:
                return None, binding
            output['scores'][index].backward()
        values = _cam(captured['activation'], captured['gradient'], method, (512, 512))
        if constrained:
            values = values * (output['masks'][index, 0].detach().cpu().numpy() >= .5)
        return values, binding
    finally:
        handle.remove()


def _segmentation_map(model, gray, roi, method):
    import torch
    from .xai_engine import _cam
    captured = {}

    def hook(_module, _inputs, output):
        captured['activation'] = output
        output.register_hook(lambda gradient: captured.__setitem__('gradient', gradient))

    handle = model.d0.register_forward_hook(hook)
    try:
        with torch.enable_grad():
            target = model(torch.from_numpy(gray.copy())[None, None].requires_grad_(True))[0, 0][torch.from_numpy(roi)].mean()
            target.backward()
        return _cam(captured['activation'], captured['gradient'], method, (512, 512)), 'run_vessel_pixels'
    finally:
        handle.remove()


def check(prepared, task, method, values, candidate=None, constrained=False):
    """Compare the saved map with head-only and fully randomized model maps of the same form."""
    if method == 'occlusion':
        return dict(randomization='NOT_TESTED', randomization_protocol=PROTOCOL,
                    randomization_note='Not run for occlusion maps (64 forward passes per randomized model).')
    import torch
    from .xai_detector_faithfulness import randomized_copy
    from .xai_engine import _load_inputs, _models, _normalize, _polygon_mask
    from .xai_faithfulness import map_similarity
    color, gray = _load_inputs(prepared)
    artery, detector = _models()
    stages = []
    if task == 'stenosis':
        reference = _polygon_mask(candidate['polygon_prepared_xy'])
        plan = (('head', DETECTOR_STAGES['head']), ('full', _detector_full_names()))
        for stage, names in plan:
            model = randomized_copy(detector, names, seed=SEED, score_thresh=0.0)
            randomized, binding = _detector_map(model, color, reference, method, constrained)
            stages.append((stage, randomized, binding))
    else:
        with torch.inference_mode():
            roi = (artery(torch.from_numpy(gray.copy())[None, None]).sigmoid()[0, 0] >= .5).numpy()
        for stage, names in SEGMENTATION_STAGES.items():
            model = randomized_copy(artery, names, seed=SEED)
            randomized, binding = _segmentation_map(model, gray, roi, method)
            stages.append((stage, randomized, binding))
    rows = []
    for stage, randomized, binding in stages:
        similarity = (map_similarity(values, _normalize(randomized)) if randomized is not None
                      else dict(spearman=None, absolute_spearman=None, ssim=None))
        rows.append(dict(stage=stage, target_binding=binding,
                         spearman=None if similarity['spearman'] is None else round(similarity['spearman'], 4),
                         ssim=None if similarity['ssim'] is None else round(similarity['ssim'], 4)))
    full = rows[-1]
    if full['spearman'] is None:
        outcome = 'NOT_EVALUABLE'
        note = 'The fully randomized model gave a constant or missing map, so rank correlation is undefined.'
    else:
        outcome = 'PASS' if abs(full['spearman']) <= GATE_ABS_SPEARMAN else 'FAIL'
        note = (f"|rho| {abs(full['spearman']):.2f} against the fully randomized model "
                f"({'within' if outcome == 'PASS' else 'above'} the {GATE_ABS_SPEARMAN} gate); head-only rho "
                f"{'undefined' if rows[0]['spearman'] is None else format(rows[0]['spearman'], '.2f')}.")
    return dict(randomization=outcome, randomization_protocol=PROTOCOL, randomization_seed=SEED,
                randomization_gate=f'|spearman| <= {GATE_ABS_SPEARMAN} vs fully randomized model',
                randomization_stages=rows, randomization_note=note)
