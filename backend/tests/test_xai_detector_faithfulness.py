import numpy as np
import pytest

torch = pytest.importorskip('torch')
pytest.importorskip('torchvision')

from torch import nn  # noqa: E402
from torchvision.ops.misc import FrozenBatchNorm2d  # noqa: E402

from app.xai_detector_faithfulness import (  # noqa: E402
    candidate_score_fn, cascading_randomized_models, detector_cams, randomized_copy, retained_candidates)
from app.xai_faithfulness import evaluate_forward_occlusion, map_similarity, structural_similarity  # noqa: E402

SIZE = 32


class _Body(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(3, 4, 3, padding=1)
        self.bn1 = FrozenBatchNorm2d(4)
        self.layer4 = nn.Conv2d(4, 4, 1)


class _Backbone(nn.Module):
    def __init__(self):
        super().__init__()
        self.body = _Body()


class _RoiHeads(nn.Module):
    def __init__(self):
        super().__init__()
        self.score_thresh = 0.05
        self.box_predictor = nn.Linear(1, 1)


class KnownTruthDetector(nn.Module):
    """One foreground detection whose score depends only on the top-left 8x8 block."""

    def __init__(self):
        super().__init__()
        self.backbone = _Backbone()
        self.roi_heads = _RoiHeads()
        with torch.no_grad():
            self.backbone.body.conv1.weight.zero_()
            self.backbone.body.conv1.bias.zero_()
            for channel in range(4):
                self.backbone.body.conv1.weight[channel, :, 1, 1] = 1.0
            self.backbone.body.layer4.weight.copy_(torch.eye(4)[:, :, None, None])
            self.backbone.body.layer4.bias.zero_()

    def forward(self, images):
        x = torch.stack(images)
        activation = self.backbone.body.layer4(self.backbone.body.bn1(self.backbone.body.conv1(x)))
        score = torch.sigmoid(activation[:, :, :8, :8].mean() * .5 - 1)
        mask = torch.zeros(1, 1, SIZE, SIZE)
        mask[..., :8, :8] = 1
        return [{'labels': torch.tensor([1]), 'scores': score.reshape(1), 'masks': mask}]


def _image():
    image = np.zeros((3, SIZE, SIZE), dtype=np.float32)
    image[:, :8, :8] = 1
    return image


def test_ssim_and_rank_similarity_identify_identical_and_unrelated_maps():
    rng = np.random.default_rng(7)
    first = rng.random((32, 32))
    assert structural_similarity(first, first) == pytest.approx(1.0)
    same = map_similarity(first, first)
    assert same['spearman'] == pytest.approx(1.0) and same['ssim'] == pytest.approx(1.0)
    unrelated = map_similarity(first, rng.random((32, 32)))
    assert unrelated['absolute_spearman'] < .2 and unrelated['ssim'] < .2
    assert map_similarity(first, np.zeros_like(first))['spearman'] is None
    with pytest.raises(ValueError, match='geometry'):
        map_similarity(first, first[:4])


def test_detector_cams_localize_the_known_target_and_bind_the_score():
    model = KnownTruthDetector().eval()
    image = _image()
    output = model([torch.from_numpy(image)])[0]
    candidates = retained_candidates(output, 0.1)
    assert len(candidates) == 1
    masks = [candidates[0]['mask']]
    maps, binding = detector_cams(model, image, masks)
    assert binding == {'targets': 1, 'binding': 'matched_original_candidates'}
    for name in ('gradcam_raw', 'gradcampp_raw', 'gradcam_constrained', 'gradcampp_constrained'):
        cam = maps[name]
        assert cam.shape == (SIZE, SIZE) and np.isfinite(cam).all() and 0 <= cam.min() and cam.max() <= 1
        assert cam[:8, :8].mean() > cam[16:, 16:].mean()
    assert maps['gradcam_constrained'][8:, 8:].max() == 0

    score = candidate_score_fn(model, masks)
    result = evaluate_forward_occlusion(image, maps['gradcam_raw'], score, grid=4)
    assert result['gates']['deletion'] and result['gates']['insertion']
    lost = np.zeros((SIZE, SIZE), dtype=bool)
    lost[-4:, -4:] = True
    assert candidate_score_fn(model, [lost])(image) == 0.0


def test_randomized_copies_never_mutate_the_frozen_model():
    model = KnownTruthDetector().eval()
    before = {name: value.clone() for name, value in model.state_dict().items()}
    stages = (('head', ('roi_heads.box_predictor',)), ('layer4', ('backbone.body.layer4',)),
              ('stem', ('backbone.body.conv1', 'backbone.body.bn1')))
    produced = list(cascading_randomized_models(model, seed=3, stages=stages))
    assert [stage for stage, _, _ in produced] == ['head', 'layer4', 'stem']
    assert produced[-1][1] == ('roi_heads.box_predictor', 'backbone.body.layer4',
                               'backbone.body.conv1', 'backbone.body.bn1')
    for name, value in model.state_dict().items():
        assert torch.equal(value, before[name]), name
    assert model.roi_heads.score_thresh == 0.05
    _, _, last = produced[-1]
    assert last.roi_heads.score_thresh == 0.0
    assert not torch.equal(last.backbone.body.layer4.weight, model.backbone.body.layer4.weight)
    assert torch.equal(produced[0][2].backbone.body.layer4.weight, model.backbone.body.layer4.weight)
    assert torch.equal(last.backbone.body.bn1.running_var, torch.ones(4))
    again = randomized_copy(model, ('backbone.body.layer4',), seed=3)
    assert torch.equal(again.backbone.body.layer4.weight, produced[1][2].backbone.body.layer4.weight)


def test_unmatched_randomized_target_uses_declared_fallback_only_when_requested():
    model = KnownTruthDetector().eval()
    elsewhere = np.zeros((SIZE, SIZE), dtype=bool)
    elsewhere[-4:, -4:] = True
    maps, binding = detector_cams(model, _image(), [elsewhere])
    assert binding['binding'] == 'no_target' and maps['gradcam_raw'] is None
    maps, binding = detector_cams(model, _image(), [elsewhere], fallback_to_top=True)
    assert binding == {'targets': 1, 'binding': 'top_foreground_detection_fallback'}
    assert maps['gradcampp_raw'] is not None
