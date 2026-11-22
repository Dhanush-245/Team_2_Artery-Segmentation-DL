"""Gradient-based attribution weightings shared by the detector explanations.

Grad-CAM weights each feature channel by its mean gradient. Grad-CAM++ (Chattopadhay et al.,
WACV 2018) weights channels by positive gradients scaled with second/third-order terms, which
tends to cover several instances of the same class instead of only the strongest one. Both are
saliency maps for research review, not clinical explanations.
"""


def _spatial(tensor):
    """Spatial dims of an (N, C, *spatial) tensor: (2, 3) for 2D maps, (2, 3, 4) for volumes."""
    return tuple(range(2, tensor.ndim))


def gradcam_weights(gradient):
    return gradient.mean(dim=_spatial(gradient), keepdim=True)


def gradcam_plus_plus_weights(activation, gradient, eps: float = 1e-8):
    import torch
    grad_2 = gradient.pow(2)
    grad_3 = gradient.pow(3)
    activation_sum = activation.sum(dim=_spatial(activation), keepdim=True)
    denominator = 2 * grad_2 + activation_sum * grad_3
    alpha = torch.where(denominator.abs() > eps, grad_2 / denominator, torch.zeros_like(denominator))
    return (alpha * torch.relu(gradient)).sum(dim=_spatial(gradient), keepdim=True)


def weighted_cam(activation, weights):
    import torch
    return torch.relu((weights * activation).sum(dim=1, keepdim=True))
