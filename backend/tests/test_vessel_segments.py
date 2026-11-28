import numpy as np
import pytest

from app import vessel_segments as vs


def labels_with(segment_id, rows=slice(200, 260), cols=slice(200, 260)):
    labels = np.zeros(vs.INPUT_SIZE, np.uint8)
    labels[rows, cols] = segment_id
    return labels


def square(x0=220, y0=220, x1=240, y1=240):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def test_reliable_segment_is_assigned_with_anatomy():
    result = vs.assign(labels_with(6), vs.region(square()))
    assert result == {'outcome': 'assigned', 'segment': '6', 'anatomy': 'LAD proximal', 'vote_share': 1.0}


def test_unreliable_segment_is_not_named():
    result = vs.assign(labels_with(25), vs.region(square()))  # ARCADE id 25 = segment 14b
    assert result['outcome'] == 'unreliable_segment' and result['anatomy'] is None


def test_split_vote_is_ambiguous():
    labels = labels_with(1, cols=slice(200, 230))
    labels[200:260, 230:260] = 5
    labels[200:260, 228:232] = 6
    result = vs.assign(labels, vs.region(square(218, 218, 242, 242)))
    assert result['outcome'] == 'ambiguous'


def test_no_predicted_vessel_in_region():
    result = vs.assign(np.zeros(vs.INPUT_SIZE, np.uint8), vs.region(square()))
    assert result['outcome'] == 'no_vessel_predicted' and result['segment'] is None


def test_region_is_dilated_by_five_pixels():
    area = vs.region(square(100, 100, 110, 110))
    ys, xs = np.nonzero(area)
    assert xs.min() == 95 and ys.max() == 115


def test_polygon_formats_and_degenerate_polygon():
    assert vs.polygon_points({'polygon_prepared_xy': [1, 2, 3, 4, 5, 6]}) == [(1, 2), (3, 4), (5, 6)]
    assert vs.polygon_points({'polygon_prepared_xy': [[[1, 2], [3, 4], [5, 6]]]}) == [[1, 2], [3, 4], [5, 6]]
    with pytest.raises(ValueError):
        vs.region([[1, 1], [2, 2]])


def test_unverified_checkpoint_is_unavailable(tmp_path, monkeypatch):
    fake = tmp_path / 'segments.pt'
    fake.write_bytes(b'not the released checkpoint')
    monkeypatch.setenv('COROVISION_SEGMENT_CHECKPOINT', str(fake))
    assert vs.available() is False
    monkeypatch.setenv('COROVISION_SEGMENT_CHECKPOINT', str(tmp_path / 'missing.pt'))
    assert vs.available() is False


def test_reliable_set_matches_frozen_protocol():
    assert vs.PROTOCOL['reliable_segments'] == ['1', '2', '3', '4', '5', '6', '7', '8', '11', '13', '16']


def _saved_run(client, headers, candidates):
    import json
    from io import BytesIO
    from uuid import uuid4

    from PIL import Image

    from app.database import SessionLocal
    from app.models import AnalysisEvent
    case = client.post("/api/cases", headers=headers, json={"case_code": "SEG-" + uuid4().hex[:6],
                                                           "modality": "XCA", "anatomy": "coronary"}).json()
    stream = BytesIO(); Image.new("L", (512, 512), 90).save(stream, "PNG")
    image = client.post(f"/api/cases/{case['id']}/images", headers=headers,
                        files={"file": ("frame.png", stream.getvalue(), "image/png")}).json()
    with SessionLocal() as db:
        event = AnalysisEvent(image_id=image["id"], model_version="test", artery_pixels=0, stenosis_pixels=0,
                              overlay_path="/nonexistent/overlay.png",
                              validation_json=json.dumps({"structured_result": {"candidates": candidates}}))
        db.add(event); db.commit()
        return case, event.id


def test_endpoint_respects_case_access_and_reports_missing_model(monkeypatch, tmp_path):
    from uuid import uuid4

    from fastapi.testclient import TestClient

    from app.main import app
    from test_rbac_system import make_user
    monkeypatch.setenv("COROVISION_SEGMENT_CHECKPOINT", str(tmp_path / "missing.pt"))
    with TestClient(app) as client:
        _, owner = make_user(f"seg-owner-{uuid4().hex}@example.org", "researcher")
        _, outsider = make_user(f"seg-out-{uuid4().hex}@example.org", "researcher")
        case, event_id = _saved_run(client, owner, [{"candidate_id": "C1", "polygon_prepared_xy": square()}])
        url = f"/api/cases/{case['id']}/vessel-segments/{event_id}"
        assert client.get(url, headers=outsider).status_code == 404
        assert client.get(f"/api/cases/{case['id']}/vessel-segments/missing", headers=owner).status_code == 404
        body = client.get(url, headers=owner).json()
        assert body["status"] == "unavailable" and body["records"] == []
        assert body["clinical_validated"] is False and body["protocol"]["id"] == "corovision-lesion-to-segment-v1"


def test_endpoint_labels_candidates_when_model_runs(monkeypatch):
    from uuid import uuid4

    from fastapi.testclient import TestClient

    from app.main import app
    from test_rbac_system import make_user
    monkeypatch.setattr(vs, "available", lambda: True)
    monkeypatch.setattr(vs, "predict", lambda gray: labels_with(13))
    with TestClient(app) as client:
        _, owner = make_user(f"seg-run-{uuid4().hex}@example.org", "researcher")
        case, event_id = _saved_run(client, owner, [{"candidate_id": "C1", "polygon_prepared_xy": square()},
                                                    {"candidate_id": "C2", "polygon_prepared_xy": [[1, 1]]}])
        body = client.get(f"/api/cases/{case['id']}/vessel-segments/{event_id}", headers=owner).json()
        assert body["status"] == "completed"
        assert body["records"][0] == {"candidate_id": "C1", "outcome": "assigned", "segment": "11",
                                      "anatomy": "LCx proximal", "vote_share": 1.0}
        assert body["records"][1]["outcome"] == "region_unavailable"


def test_endpoint_reports_failed_status_when_labelling_raises(monkeypatch):
    """A labelling error must come back as a 'failed' status, not an unhandled server error."""
    from uuid import uuid4

    from fastapi.testclient import TestClient

    from app.main import app
    from test_rbac_system import make_user

    def broken(*_args, **_kwargs):
        raise RuntimeError("synthetic labelling failure")

    monkeypatch.setattr(vs, "available", lambda: True)
    monkeypatch.setattr(vs, "label_candidates", broken)
    with TestClient(app, raise_server_exceptions=False) as client:
        _, owner = make_user(f"seg-fail-{uuid4().hex}@example.org", "researcher")
        case, event_id = _saved_run(client, owner, [{"candidate_id": "C1", "polygon_prepared_xy": square()}])
        response = client.get(f"/api/cases/{case['id']}/vessel-segments/{event_id}", headers=owner)
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "failed"
