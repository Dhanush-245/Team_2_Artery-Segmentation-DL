"""Reviewer caliper measurements: server-computed widths, append-only, reviewer roles only."""
from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from test_rbac_system import make_user


def _case_with_image(client, headers):
    case = client.post("/api/cases", headers=headers, json={"case_code": "REF-" + uuid4().hex[:6], "modality": "XCA", "anatomy": "coronary"}).json()
    stream = BytesIO(); Image.new("L", (1024, 1024), 90).save(stream, "PNG")
    image = client.post(f"/api/cases/{case['id']}/images", headers=headers, files={"file": ("frame.png", stream.getvalue(), "image/png")}).json()
    return case, image


def test_reviewer_measurement_is_computed_on_the_server_and_listed():
    with TestClient(app) as client:
        _, doctor = make_user(f"ref-doctor-{uuid4().hex}@example.org", "doctor")
        case, image = _case_with_image(client, doctor)
        body = {"image_id": image["id"], "lesion_id": "L1", "ai_overlay_visible": False,
                "minimum": [[100, 100], [100, 103]], "reference": [[120, 100], [120, 110]],
                "notes": "proximal segment"}
        response = client.post(f"/api/cases/{case['id']}/reference-measurements", headers=doctor, json=body)
        assert response.status_code == 201, response.text
        row = response.json()
        # 1024 px source shown on a 512 prepared grid: 2 source px per prepared px.
        assert row["minimum_diameter"] == 6.0 and row["reference_diameter"] == 20.0
        assert row["diameter_unit"] == "source_px" and row["narrowing_percent"] == 70.0
        assert row["independent_of_corovision"] is True and row["reviewer_id"]
        assert row["source_image_sha256"] and len(row["source_image_sha256"]) == 64
        listed = client.get(f"/api/cases/{case['id']}/reference-measurements", headers=doctor).json()
        assert [item["id"] for item in listed] == [row["id"]]
        csv = client.get(f"/api/cases/{case['id']}/reference-measurements/export.csv", headers=doctor)
        assert csv.status_code == 200 and "reference_narrowing_percent" in csv.text.splitlines()[0]


def test_overlay_visible_rows_are_not_independent_and_invalid_input_is_rejected():
    with TestClient(app) as client:
        _, doctor = make_user(f"ref-doctor2-{uuid4().hex}@example.org", "doctor")
        case, image = _case_with_image(client, doctor)
        url = f"/api/cases/{case['id']}/reference-measurements"
        seen = client.post(url, headers=doctor, json={"image_id": image["id"], "lesion_id": "L1", "ai_overlay_visible": True,
                                                       "minimum": [[0, 0], [0, 2]], "reference": [[10, 0], [10, 8]]}).json()
        assert seen["independent_of_corovision"] is False
        wider = client.post(url, headers=doctor, json={"image_id": image["id"], "lesion_id": "L2", "ai_overlay_visible": False,
                                                       "minimum": [[0, 0], [0, 9]], "reference": [[10, 0], [10, 4]]})
        assert wider.status_code == 422
        outside = client.post(url, headers=doctor, json={"image_id": image["id"], "lesion_id": "L3", "ai_overlay_visible": False,
                                                         "minimum": [[0, 0], [0, 600]], "reference": [[10, 0], [10, 700]]})
        assert outside.status_code == 422


def test_only_reviewers_can_record_measurements():
    with TestClient(app) as client:
        _, researcher = make_user(f"ref-res-{uuid4().hex}@example.org", "researcher")
        case, image = _case_with_image(client, researcher)
        response = client.post(f"/api/cases/{case['id']}/reference-measurements", headers=researcher,
                               json={"image_id": image["id"], "lesion_id": "L1", "ai_overlay_visible": False,
                                     "minimum": [[0, 0], [0, 2]], "reference": [[10, 0], [10, 8]]})
        assert response.status_code == 403
