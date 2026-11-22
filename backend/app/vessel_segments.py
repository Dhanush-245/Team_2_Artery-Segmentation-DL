"""Research-only "likely vessel segment" labels for saved 2D stenosis candidates.

A 26-class ARCADE SYNTAX segment model labels each vessel pixel of the prepared 512x512 image.
Each candidate is assigned with the frozen protocol corovision-lesion-to-segment-v1:
the candidate polygon is dilated by 5 px, predicted-vessel pixels inside it vote, and a
segment is reported only when it wins >= 50% of the votes and belongs to the reliable set.
Validation-only evidence (ARCADE val): ~0.90 precision on reliable segments; a lesion on
a side branch can be attributed to its parent segment. Not a clinical localisation.
"""
from __future__ import annotations

import hashlib
import os
import threading
from collections import Counter
from functools import lru_cache
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CHECKPOINT_SHA256 = 'f74ee0da6ab23a55878e5a211099ce7d06a8fa1fa49f11c90e95a343d9ec44c5'
MODEL_ID = 'arcade-syntax-segments-resnet34-unet-26c-v1'
NUM_CLASSES = 26
INPUT_SIZE = (512, 512)
DILATE = 11
MIN_SHARE = 0.5
# ARCADE syntax category id -> SYNTAX segment label (id 26 'stenosis' is not a segment).
SEGMENT_NAMES = {1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '9a',
                 11: '10', 12: '10a', 13: '11', 14: '12', 15: '12a', 16: '13', 17: '14', 18: '14a',
                 19: '15', 20: '16', 21: '16a', 22: '16b', 23: '16c', 24: '12b', 25: '14b'}
# Usual SYNTAX naming, for orientation only.
ANATOMY = {'1': 'RCA proximal', '2': 'RCA mid', '3': 'RCA distal', '4': 'Posterior descending (RCA)',
           '5': 'Left main', '6': 'LAD proximal', '7': 'LAD mid', '8': 'LAD apical',
           '11': 'LCx proximal', '13': 'LCx distal', '16': 'Posterolateral branch (RCA)'}
RELIABLE = frozenset(ANATOMY)
PROTOCOL = dict(
    id='corovision-lesion-to-segment-v1',
    reliable_segment_rule='validation Dice >= 0.60 and >= 30 validation images with ground truth',
    reliable_segments=sorted(RELIABLE, key=int),
    lesion_region='candidate polygon dilated by 5 px',
    min_vote_share=MIN_SHARE,
    validation='ARCADE validation only: precision 0.901 and coverage 0.812 on reliable segments; '
               'side-branch lesions can be named as the parent segment',
)
OUTCOMES = ('assigned', 'unreliable_segment', 'ambiguous', 'no_vessel_predicted', 'region_unavailable')
LOCK = threading.Lock()


def checkpoint_path() -> Path:
    return Path(os.getenv('COROVISION_SEGMENT_CHECKPOINT', ROOT / 'models/segment_release/syntax_segments_26c.pt'))


@lru_cache(maxsize=4)
def _verified(path: str, size: int, mtime: float) -> bool:
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() == CHECKPOINT_SHA256


def available() -> bool:
    path = checkpoint_path()
    if not path.is_file():
        return False
    stat = path.stat()
    return _verified(str(path), stat.st_size, stat.st_mtime)


def _network():
    import torch
    from torch import nn
    from torchvision.models import resnet34

    def block(a, b):
        return nn.Sequential(nn.Conv2d(a, b, 3, padding=1, bias=False), nn.GroupNorm(8, b), nn.ReLU(),
                             nn.Conv2d(b, b, 3, padding=1, bias=False), nn.GroupNorm(8, b), nn.ReLU())

    class SegmentUNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = resnet34(weights=None)
            self.d3, self.d2 = block(512 + 256, 256), block(256 + 128, 128)
            self.d1, self.d0 = block(128 + 64, 64), block(64 + 64, 32)
            self.head = nn.Conv2d(32, NUM_CLASSES, 1)
            self.register_buffer('mean', torch.tensor([.485, .456, .406])[None, :, None, None])
            self.register_buffer('std', torch.tensor([.229, .224, .225])[None, :, None, None])

        def forward(self, x):
            size = x.shape[-2:]
            x = (x.repeat(1, 3, 1, 1) - self.mean) / self.std
            e = self.encoder
            a = e.relu(e.bn1(e.conv1(x)))
            b = e.layer1(e.maxpool(a))
            c = e.layer2(b)
            d = e.layer3(c)
            z = e.layer4(d)

            def up(low, skip):
                return torch.cat([nn.functional.interpolate(low, size=skip.shape[-2:], mode='bilinear',
                                                            align_corners=False), skip], 1)
            z = self.d0(up(self.d1(up(self.d2(up(self.d3(up(z, d)), c)), b)), a))
            return self.head(nn.functional.interpolate(z, size=size, mode='bilinear', align_corners=False))

    return SegmentUNet()


@lru_cache(maxsize=1)
def _model(path: str):
    import torch
    blob = torch.load(path, map_location='cpu', weights_only=False)
    model = _network()
    model.load_state_dict(blob['model'])
    return model.eval()


def predict(gray: np.ndarray) -> np.ndarray:
    """Return per-pixel ARCADE segment ids (0 = background) for a 512x512 uint8 image."""
    import torch
    if gray.shape != INPUT_SIZE:
        raise ValueError('The segment model requires the prepared 512x512 image')
    with LOCK, torch.inference_mode():
        logits = _model(str(checkpoint_path()))(torch.from_numpy(gray.astype(np.float32) / 255)[None, None])
    return logits.argmax(1)[0].numpy().astype(np.uint8)


def region(polygon, shape=INPUT_SIZE) -> np.ndarray:
    from PIL import Image, ImageDraw, ImageFilter
    canvas = Image.new('L', (shape[1], shape[0]), 0)
    points = [(float(x), float(y)) for x, y in polygon]
    if len(points) < 3:
        raise ValueError('Candidate polygon needs at least three points')
    ImageDraw.Draw(canvas).polygon(points, fill=255)
    return np.asarray(canvas.filter(ImageFilter.MaxFilter(DILATE))) > 0


def assign(labels: np.ndarray, area: np.ndarray) -> dict:
    votes = labels[area & (labels > 0)]
    if votes.size == 0:
        return dict(outcome='no_vessel_predicted', segment=None, anatomy=None, vote_share=0.0)
    label, count = Counter(votes.tolist()).most_common(1)[0]
    share = round(count / votes.size, 3)
    name = SEGMENT_NAMES[int(label)]
    if share < MIN_SHARE:
        return dict(outcome='ambiguous', segment=name, anatomy=None, vote_share=share)
    if name not in RELIABLE:
        return dict(outcome='unreliable_segment', segment=name, anatomy=None, vote_share=share)
    return dict(outcome='assigned', segment=name, anatomy=ANATOMY[name], vote_share=share)


def polygon_points(candidate: dict):
    raw = candidate.get('polygon_prepared_xy') or []
    if raw and isinstance(raw[0], (int, float)):
        raw = list(zip(raw[0::2], raw[1::2]))
    elif raw and isinstance(raw[0], list) and raw[0] and isinstance(raw[0][0], list):
        raw = raw[0]
    return raw


def label_candidates(prepared_image: Path, candidates: list[dict]) -> list[dict]:
    from PIL import Image
    with Image.open(prepared_image) as source:
        gray = np.asarray(source.convert('L'))
    labels = predict(gray)
    records = []
    for candidate in candidates:
        identity = candidate.get('candidate_id')
        try:
            area = region(polygon_points(candidate), labels.shape)
        except (ValueError, TypeError):
            records.append(dict(candidate_id=identity, outcome='region_unavailable', segment=None,
                                anatomy=None, vote_share=0.0))
            continue
        records.append(dict(candidate_id=identity, **assign(labels, area)))
    return records
