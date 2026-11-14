import copy
import pytest
from app.volume_reporting import snapshot, csv_text


def fixture():
    return {'id':'run','case_id':'case','status':'completed','input_kind':'medical_study',
            'result':{'model_id':'pinned','coarse_foreground_voxels':0,'source_shape':[16,18,20]}}


def test_report_grounding_missing_evidence_and_preservation():
    run=fixture(); before=copy.deepcopy(run); result=snapshot(run)
    assert run==before
    assert result['analysis_run_id']=='run' and result['case_id']=='case'
    assert result['predicted_coarse_foreground_voxels']==0
    assert result['severity_category'] is None and result['narrowing_percent'] is None
    assert result['stages']['stenosis_detection']['status']=='unavailable'
    assert result['stages']['severity']['status']=='not_assessable'
    assert result['snapshot_sha256']==snapshot(run)['snapshot_sha256']
    run['id']='other'; assert snapshot(run)['snapshot_sha256']!=result['snapshot_sha256']


@pytest.mark.parametrize('status',['queued','running','failed'])
def test_incomplete_run_cannot_be_exported(status):
    run=fixture();run['status']=status
    with pytest.raises(ValueError):snapshot(run)


def test_csv_formula_escape():
    run=fixture();run['result']['model_id']='=unsafe'
    assert "'=unsafe" in csv_text(snapshot(run))


def test_abstained_geometry_has_stable_rendering_contract_without_mutation():
    run = fixture()
    run['experimental_geometry'] = {
        'status': 'abstained', 'method': 'test-method',
        'reasons': ['disconnected_prediction'], 'clinical_validated': False,
    }
    before = copy.deepcopy(run)
    result = snapshot(run)
    assert run == before
    assert result['experimental_geometry']['paths'] == []
    assert result['experimental_geometry']['candidates'] == []
    assert result['experimental_geometry']['limitations'] == [
        'Measurement withheld: disconnected prediction.'
    ]
    assert result['stages']['vessel_graph']['status'] == 'not_assessable'
    assert result['stages']['severity']['reason'] == (
        '3D mask geometry withheld: disconnected prediction.'
    )
    assert result['severity_status'] == 'indeterminate'


def test_eligible_geometry_promotes_primary_experimental_severity():
    run = fixture()
    run['experimental_geometry'] = {
        'status': 'experimental_mask_geometry', 'method': 'component-local-test',
        'paths': [{'id': 'P1'}],
        'candidates': [{
            'id': 'C1', 'path_id': 'P1', 'narrowing_percent': 43.08,
            'severity': 'mild', 'minimum_diameter_mm': 5.59,
            'reference_diameter_mm': 9.82, 'location_ras_mm': [1, 2, 3],
        }],
    }
    result = snapshot(run)
    assert result['narrowing_percent'] == 43.08
    assert result['severity_category'] == 'mild'
    assert result['severity_status'] == 'experimental_research_grade'
    assert result['severity_candidate_id'] == 'C1'


def test_report_api_identity_access_and_failed_run():
    import json
    from uuid import uuid4
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import SessionLocal
    from app.models import VolumeAnalysis
    from test_rbac_system import make_user
    suffix=uuid4().hex
    with TestClient(app) as client:
        owner,headers=make_user('volume-report-'+suffix+'@example.org','researcher')
        _,outsider=make_user('volume-report-other-'+suffix+'@example.org','researcher')
        case=client.post('/api/cases',headers=headers,json={'case_code':'REPORT-'+suffix,'modality':'CTA'}).json()
        other=client.post('/api/cases',headers=headers,json={'case_code':'OTHER-'+suffix,'modality':'CTA'}).json()
        run_id=uuid4().hex
        with SessionLocal() as db:
            db.add(VolumeAnalysis(id=run_id,case_id=case['id'],created_by=owner['id'],status='completed',
                source_sha256='a'*64,result_json=json.dumps(fixture()['result'])))
            db.commit()
        url=f'/api/cases/{case["id"]}/volumes/analyses/{run_id}/report/json'
        assert client.get(url).status_code==401
        assert client.get(url,headers=outsider).status_code==404
        response=client.get(url,headers=headers); assert response.status_code==200
        assert response.json()['analysis_run_id']==run_id
        assert client.get(url.replace(case['id'],other['id']),headers=headers).status_code==404
        assert client.get(url[:-4]+'csv',headers=headers).status_code==200
        pdf_url = url[:-4] + 'pdf'
        assert client.get(pdf_url, headers=outsider).status_code == 404
        pdf = client.get(pdf_url, headers=headers)
        assert pdf.headers['content-type'] == 'application/pdf'
        assert pdf.headers['content-disposition'] == f'attachment; filename="volume-{run_id}.pdf"'
        assert pdf.content.startswith(b'%PDF-')
        with SessionLocal() as db:
            db.get(VolumeAnalysis,run_id).status='failed';db.commit()
        assert client.get(url,headers=headers).status_code==409
