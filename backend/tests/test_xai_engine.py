"""Case-specific XAI engine and API: identity, targets, authorization, persistence and integrity."""
import json
from io import BytesIO
from uuid import uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import trained_release as tr
from app import xai_engine as engine
from app.main import app
from test_rbac_system import make_user

SQUARE = [[200, 200], [240, 200], [240, 240], [200, 240]]
OTHER = [[300, 300], [340, 300], [340, 340], [300, 340]]


def test_identity_is_deterministic_and_field_sensitive():
    base = dict(case_id='a', run_id='r', target_id='C1', method='gradcam')
    assert engine.identity(**base) == engine.identity(**dict(base))
    assert engine.identity(**base) != engine.identity(**dict(base, target_id='C2'))
    assert engine.identity(**base) != engine.identity(**dict(base, method='gradcampp'))


def test_normalize_clips_and_handles_empty_and_nan():
    values = np.array([[-1.0, np.nan], [2.0, 4.0]], np.float32)
    out = engine._normalize(values)
    assert out.max() == 1.0 and out.min() == 0.0 and np.isfinite(out).all()
    assert engine._normalize(np.zeros((2, 2))).max() == 0


def test_occlusion_marks_only_cells_that_change_the_target():
    color = np.zeros((512, 512, 3), np.float32)
    color[0:64, 0:64] = 1.0   # the target depends only on the top-left cell

    def score(values):
        return float(values[0:64, 0:64].mean())
    heat = engine._occlude(color, score, score(color))
    assert heat[10, 10] > 0 and heat[300, 300] == 0


def test_summary_reports_energy_inside_target():
    values = np.zeros((512, 512), np.float32)
    values[210:220, 210:220] = 1
    summary = engine.summarize(values, engine._polygon_mask(SQUARE))
    assert summary['energy_inside_target_mask'] == 1.0 and summary['peak_inside_target_mask'] is True


def _run(client, headers, candidates, model_version=None):
    from app.database import SessionLocal
    from app.models import AnalysisEvent
    case = client.post('/api/cases', headers=headers, json={'case_code': 'XAI-' + uuid4().hex[:6],
                                                           'modality': 'XCA', 'anatomy': 'coronary'}).json()
    stream = BytesIO(); Image.new('L', (512, 512), 90).save(stream, 'PNG')
    image = client.post(f"/api/cases/{case['id']}/images", headers=headers,
                        files={'file': ('frame.png', stream.getvalue(), 'image/png')}).json()
    with SessionLocal() as db:
        event = AnalysisEvent(image_id=image['id'], model_version=model_version or tr.RELEASE['version'],
                              artery_pixels=0, stenosis_pixels=0, overlay_path='/nonexistent/overlay.png',
                              validation_json=json.dumps({'structured_result': {'candidates': candidates}}))
        db.add(event); db.commit()
        return case, event.id


@pytest.fixture()
def fake_models(monkeypatch):
    """Stand-in attribution so API behaviour is tested without checkpoints; real parity is tested below."""
    calls = []

    def stenosis(prepared, candidate, method, threshold):
        calls.append((candidate['candidate_id'], method))
        values = np.zeros((512, 512), np.float32)
        x0, y0 = candidate['polygon_prepared_xy'][0]
        values[int(y0):int(y0) + 40, int(x0):int(x0) + 40] = 1.0
        return values, dict(target_score=0.9, match_iou=1.0, target_layer=engine.DETECTOR_LAYER,
                            predicted_mask=engine._polygon_mask(candidate['polygon_prepared_xy']))

    def segmentation(prepared, method):
        calls.append(('vessel_mask', method))
        values = np.ones((512, 512), np.float32)
        return values, dict(target_score=1.0, roi_pixels=10, target_layer='d0', predicted_mask=values > 0)
    monkeypatch.setattr(tr, 'ready', lambda: True)
    monkeypatch.setattr(engine, 'stenosis_attribution', stenosis)
    monkeypatch.setattr(engine, 'segmentation_attribution', segmentation)
    return calls


def test_candidate_explanations_are_separate_cached_and_protected(fake_models):
    with TestClient(app) as client:
        _, owner = make_user(f'xai-owner-{uuid4().hex}@example.org', 'researcher')
        _, outsider = make_user(f'xai-out-{uuid4().hex}@example.org', 'researcher')
        case, event_id = _run(client, owner, [{'candidate_id': 'C1', 'polygon_prepared_xy': SQUARE, 'model_score': .6},
                                              {'candidate_id': 'C2', 'polygon_prepared_xy': OTHER, 'model_score': .3}])
        base = f"/api/cases/{case['id']}/xai/{event_id}"
        overview = client.get(base, headers=owner).json()
        assert overview['state'] == 'ELIGIBLE' and overview['zero_candidates'] is False
        assert [t['target_id'] for t in overview['targets']] == ['C1', 'C2', 'vessel_mask']
        first = client.post(base + '/explanations', headers=owner, json={'task': 'stenosis', 'target_id': 'C1', 'method': 'gradcam'})
        second = client.post(base + '/explanations', headers=owner, json={'task': 'stenosis', 'target_id': 'C2', 'method': 'gradcam'})
        assert first.status_code == 201 and second.status_code == 201
        one, two = first.json(), second.json()
        assert one['status'] == 'ready' and one['id'] != two['id']
        assert one['artifact_sha256']['heatmap'] != two['artifact_sha256']['heatmap']
        assert one['identity']['checkpoint_sha256'] == next(m['sha256'] for m in tr.RELEASE['models'] if m['task'] == 'stenosis')
        again = client.post(base + '/explanations', headers=owner, json={'task': 'stenosis', 'target_id': 'C1', 'method': 'gradcam'}).json()
        assert again['id'] == one['id'] and fake_models.count(('C1', 'gradcam')) == 1
        art = client.get(f"{base}/explanations/{one['id']}/heatmap.png", headers=owner)
        assert art.status_code == 200 and art.headers['content-type'] == 'image/png'
        assert client.get(f"{base}/explanations/{one['id']}/heatmap.png", headers=outsider).status_code == 404
        assert client.get(f"{base}/explanations/{one['id']}/secret.png", headers=owner).status_code == 404
        assert client.post(base + '/explanations', headers=owner, json={'task': 'stenosis', 'target_id': 'C9', 'method': 'gradcam'}).status_code == 422
        listed = client.get(base, headers=owner).json()['records']
        assert {r['identity']['target_id'] for r in listed} == {'C1', 'C2'}
        summary = client.get('/api/xai/summary', headers=owner).json()
        assert any(r['record_id'] == one['id'] for r in summary['records'])
        assert not any(r['record_id'] == one['id'] for r in client.get('/api/xai/summary', headers=outsider).json()['records'])


def test_record_cannot_be_read_through_another_run(fake_models):
    with TestClient(app) as client:
        _, owner = make_user(f'xai-runs-{uuid4().hex}@example.org', 'researcher')
        case, run_a = _run(client, owner, [{'candidate_id': 'C1', 'polygon_prepared_xy': SQUARE}])
        _, run_b = _run(client, owner, [{'candidate_id': 'C1', 'polygon_prepared_xy': SQUARE}])
        record = client.post(f"/api/cases/{case['id']}/xai/{run_a}/explanations", headers=owner,
                             json={'task': 'stenosis', 'target_id': 'C1', 'method': 'gradcampp'}).json()
        assert client.get(f"/api/cases/{case['id']}/xai/{run_b}/explanations/{record['id']}", headers=owner).status_code == 404


def test_tampered_artifact_is_rejected(fake_models):
    from app.main import STORAGE
    with TestClient(app) as client:
        _, owner = make_user(f'xai-tamper-{uuid4().hex}@example.org', 'researcher')
        case, run = _run(client, owner, [{'candidate_id': 'C1', 'polygon_prepared_xy': SQUARE}])
        record = client.post(f"/api/cases/{case['id']}/xai/{run}/explanations", headers=owner,
                             json={'task': 'stenosis', 'target_id': 'C1', 'method': 'gradcam'}).json()
        (STORAGE / 'xai' / run / f"{record['id']}.heatmap.png").write_bytes(b'not the saved image')
        assert client.get(f"/api/cases/{case['id']}/xai/{run}/explanations/{record['id']}/heatmap.png", headers=owner).status_code == 409


def test_zero_candidates_offer_only_segmentation(fake_models):
    with TestClient(app) as client:
        _, owner = make_user(f'xai-zero-{uuid4().hex}@example.org', 'researcher')
        case, run = _run(client, owner, [])
        base = f"/api/cases/{case['id']}/xai/{run}"
        overview = client.get(base, headers=owner).json()
        assert overview['zero_candidates'] is True and [t['task'] for t in overview['targets']] == ['segmentation']
        assert client.post(base + '/explanations', headers=owner, json={'task': 'stenosis', 'target_id': 'C1', 'method': 'gradcam'}).status_code == 422
        seg = client.post(base + '/explanations', headers=owner, json={'task': 'segmentation', 'target_id': 'vessel_mask', 'method': 'gradcam'})
        assert seg.status_code == 201 and seg.json()['identity']['task'] == 'segmentation'


def test_other_model_version_is_unsupported_without_fallback(fake_models):
    with TestClient(app) as client:
        _, owner = make_user(f'xai-model-{uuid4().hex}@example.org', 'researcher')
        case, run = _run(client, owner, [{'candidate_id': 'C1', 'polygon_prepared_xy': SQUARE}], model_version='legacy-model-v0')
        base = f"/api/cases/{case['id']}/xai/{run}"
        assert client.get(base, headers=owner).json()['state'] == 'UNSUPPORTED'
        assert client.post(base + '/explanations', headers=owner, json={'task': 'stenosis', 'target_id': 'C1', 'method': 'gradcam'}).status_code == 409
        assert fake_models == []


@pytest.mark.skipif(not tr.ready(), reason='Frozen release checkpoints are not installed')
def test_candidate_maps_match_the_production_explanation_exactly():
    import torch
    rng = np.random.default_rng(0)
    color = rng.random((512, 512, 3), dtype=np.float32)
    threshold = next(m['score_threshold'] for m in tr.RELEASE['models'] if m['task'] == 'stenosis')
    _, detector = tr._models(str(tr.artifact_root()))
    with torch.inference_mode():
        output = detector([torch.from_numpy(color.transpose(2, 0, 1).copy())])[0]
    keep = [i for i in range(len(output['scores'])) if output['labels'][i] == 1 and output['scores'][i] >= threshold]
    if len(keep) != 1:
        pytest.skip('Parity is defined for a single retained candidate')
    from skimage import measure
    mask = output['masks'][keep[0], 0].numpy() >= .5
    contour = max(measure.find_contours(mask.astype(float), .5), key=len)
    candidate = {'candidate_id': 'C1', 'polygon_prepared_xy': [[float(x), float(y)] for y, x in contour]}
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'prepared.png'
        Image.fromarray(np.uint8(color * 255)).save(path)
        color8 = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32) / 255.
        extras = {}
        production, _ = tr._detector_explanations(detector, torch.from_numpy(color8.transpose(2, 0, 1).copy()), threshold, extras=extras)
        for method, expected in (('gradcam', production), ('gradcampp', extras['gradcam_plus_plus'])):
            values, meta = engine.stenosis_attribution(path, candidate, method, threshold)
            assert np.abs(engine._normalize(values * meta['predicted_mask']) - expected).max() < 1e-5


def test_report_freezes_explanations_into_pdf_and_zip(fake_models):
    import hashlib
    from io import BytesIO as Buffer
    from zipfile import ZipFile
    with TestClient(app) as client:
        _, owner = make_user(f'xai-report-{uuid4().hex}@example.org', 'researcher')
        case, run = _run(client, owner, [{'candidate_id': 'C1', 'polygon_prepared_xy': SQUARE}])
        record = client.post(f"/api/cases/{case['id']}/xai/{run}/explanations", headers=owner,
                             json={'task': 'stenosis', 'target_id': 'C1', 'method': 'gradcam'}).json()
        image_id = client.get(f"/api/cases/{case['id']}", headers=owner).json()['images'][0]['id']
        report = client.post(f"/api/cases/{case['id']}/research-reports", headers=owner,
                             json={'image_id': image_id, 'analysis_event_id': run})
        assert report.status_code == 201, report.text
        report_id = report.json().get('report_id') or report.json()['id']
        snapshot = client.get(f"/api/cases/{case['id']}/research-reports/{report_id}/export/json", headers=owner).json()
        assert [r['id'] for r in snapshot['xai']] == [record['id']]
        assert 'overlay_path' not in json.dumps(snapshot['xai'])
        zipped = client.get(f"/api/cases/{case['id']}/research-reports/{report_id}/export/zip", headers=owner)
        assert zipped.status_code == 200
        with ZipFile(Buffer(zipped.content)) as archive:
            names = archive.namelist()
            assert 'xai_explanations.json' in names
            overlay = next(n for n in names if n.startswith('saved_artifacts/xai_C1_gradcam_'))
            assert hashlib.sha256(archive.read(overlay)).hexdigest() == record['artifact_sha256']['overlay']
            manifest = json.loads(archive.read('manifest.json'))
            assert any(a['path'] == overlay for a in manifest['artifacts'])
        assert client.get(f"/api/cases/{case['id']}/research-reports/{report_id}/export/pdf", headers=owner).status_code == 200


def test_verification_adds_per_target_randomization_and_catches_up_older_records(fake_models, monkeypatch):
    import time
    from app import xai_randomization
    verified = []
    monkeypatch.setattr(engine, 'verify', lambda *a: dict(protocol='p', metrics={}, deletion='PASS', insertion='PASS',
                                                         randomization='NOT_TESTED'))

    def check(prepared, task, method, values, candidate, constrained):
        verified.append((task, method, constrained))
        return dict(randomization='PASS', randomization_protocol=xai_randomization.PROTOCOL, randomization_note='ok')
    monkeypatch.setattr(xai_randomization, 'check', check)
    with TestClient(app) as client:
        _, owner = make_user(f'xai-rand-{uuid4().hex}@example.org', 'researcher')
        case, event_id = _run(client, owner, [{'candidate_id': 'C1', 'polygon_prepared_xy': SQUARE, 'model_score': .6}])
        base = f"/api/cases/{case['id']}/xai/{event_id}"
        record = client.post(base + '/explanations', headers=owner, json={'task': 'stenosis', 'target_id': 'C1', 'method': 'gradcam'}).json()

        def wait():
            for _ in range(100):
                body = client.get(f"{base}/explanations/{record['id']}", headers=owner).json()
                if body['verification']['status'] != 'running':
                    return body
                time.sleep(.05)
            raise AssertionError('verification did not finish')
        assert client.post(f"{base}/explanations/{record['id']}/verification", headers=owner).status_code == 202
        body = wait()
        assert body['verification']['randomization'] == 'PASS' and verified == [('stenosis', 'gradcam', False)]
        assert client.post(f"{base}/explanations/{record['id']}/verification", headers=owner).json()['verification']['status'] == 'completed'
        assert len(verified) == 1, 'a record with a randomization result is not re-run'
        # An older record verified before this check existed runs once more to add it.
        from app.main import STORAGE
        path = STORAGE / 'xai' / event_id / f"{record['id']}.json"
        saved = json.loads(path.read_text())
        saved['verification'] = dict(status='completed', deletion='PASS', insertion='PASS', randomization='NOT_TESTED')
        path.write_text(json.dumps(saved))
        assert client.post(f"{base}/explanations/{record['id']}/verification", headers=owner).status_code == 202
        assert wait()['verification']['randomization'] == 'PASS' and len(verified) == 2
