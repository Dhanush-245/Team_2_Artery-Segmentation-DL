import hashlib
from io import BytesIO
from uuid import uuid4
from zipfile import ZipFile
import json
import nibabel as nib
import numpy as np
from fastapi.testclient import TestClient
from app.main import app, STORAGE
from app.volume_reference_metrics import compare_masks
from test_rbac_system import make_user
from test_volume_xai import _volume_run


def fixture(client, headers):
    case, run = _volume_run(client, headers)
    path = STORAGE/'volumes'/run/'outputs'/'mask_source.nii.gz'
    im=nib.load(path);data=np.zeros(im.shape,np.uint8);data[3:9,3:9,2:6]=1
    nib.save(nib.Nifti1Image(data,im.affine,im.header),path)
    return case['id'],run,path


def test_reference_persistence_and_export():
    with TestClient(app) as c:
        _,h=make_user(f'ref-doc-{uuid4().hex}@test.org','doctor')
        cid,run,path=fixture(c,h);original=path.read_bytes()
        url=f'/api/cases/{cid}/volumes/analyses/{run}/reference-metrics'
        fields=dict(source_sha256='0'*64,provenance='Synthetic self-reference engineering fixture, not expert validation',same_study_confirmed='true',same_target_confirmed='true')
        assert c.get(url,headers=h).json()['records']==[]
        r=c.post(url,headers=h,data=fields,files={'file':('reference.nii.gz',original)})
        assert r.status_code==201,r.text
        record=r.json();m=record['metrics']
        assert m['dice']==m['iou']==1 and m['hd95']==m['assd']==0
        assert record['prediction_sha256']==hashlib.sha256(original).hexdigest()
        assert record['independent_validation'] is False
        assert c.get(url,headers=h).json()['records'][-1]==record
        report=f'/api/cases/{cid}/volumes/analyses/{run}/report'
        r=c.get(report+'/json',headers=h);assert r.status_code==200,r.text
        assert r.json()['reference_evaluations'][-1]==record
        assert record['id'] in c.get(report+'/csv',headers=h).text
        from pypdf import PdfReader
        r=c.get(report+'/pdf',headers=h);assert r.status_code==200,r.text
        text=' '.join(p.extract_text() for p in PdfReader(BytesIO(r.content)).pages)
        assert record['id'] in text and 'HD95 mm' in text
        r=c.get(f'/api/cases/{cid}/volumes/analyses/{run}/evidence.zip',headers=h)
        assert r.status_code==200,r.text[:100]
        with ZipFile(BytesIO(r.content)) as z:
            assert json.loads(z.read('reference_evaluations.json'))[-1]==record
            assert json.loads(z.read('manifest.json'))['files']['reference_evaluations.json']==hashlib.sha256(z.read('reference_evaluations.json')).hexdigest()
        assert path.read_bytes()==original
    with TestClient(app) as c:
        assert c.get(url,headers=h).json()['records'][-1]['id']==record['id']
        changed=nib.load(path);nib.save(nib.Nifti1Image(np.zeros(changed.shape,np.uint8),changed.affine,changed.header),path)
        assert c.get(url,headers=h).json()['records']==[]
        assert c.get(report+'/json',headers=h).json()['reference_evaluations']==[]


def test_reference_denials_geometry_and_retry(tmp_path):
    with TestClient(app) as c:
        _,h=make_user(f'ref-owner-{uuid4().hex}@test.org','doctor')
        _,other=make_user(f'ref-other-{uuid4().hex}@test.org','doctor')
        res_user,res=make_user(f'ref-res-{uuid4().hex}@test.org','researcher')
        cid,run,path=fixture(c,h)
        url=f'/api/cases/{cid}/volumes/analyses/{run}/reference-metrics'
        fields=dict(source_sha256='0'*64,provenance='Synthetic geometry validation fixture',same_study_confirmed='true',same_target_confirmed='true')
        def upload(headers=h,data=None,body=None):return c.post(url,headers=headers,data=data or fields,files={'file':('ref.nii.gz',body or path.read_bytes())})
        assert upload(other).status_code==404
        assert upload(res).status_code==403
        assert upload(data={**fields,'source_sha256':'1'*64}).status_code==409
        assert upload(data={**fields,'same_target_confirmed':'false'}).status_code==422
        assert upload(body=b'invalid nifti').status_code==422
        im=nib.load(path);affine=im.affine.copy();affine[0,3]+=1
        shifted=tmp_path/'shifted.nii.gz';nib.save(nib.Nifti1Image(np.asarray(im.dataobj),affine,im.header),shifted)
        assert upload(body=shifted.read_bytes()).status_code==422
        labels=tmp_path/'labels.nii.gz';nib.save(nib.Nifti1Image(np.full(im.shape,2,np.uint8),im.affine,im.header),labels)
        assert upload(body=labels.read_bytes()).status_code==422
        assert c.get(url,headers=h).json()['records']==[]
        assert upload().status_code==201
        assert c.post(f'/api/cases/{cid}/access',headers=h,json={'user_email_or_id':res_user['email'],'access_level':'read'}).status_code==201
        assert c.get(url,headers=res).json()['can_evaluate'] is False
        assert c.get(url,headers=res).json()['records']


def test_physical_distances_and_empty_semantics(tmp_path):
    data=np.zeros((12,12,12),np.uint8);data[3:6,3:6,3:6]=1
    a,b=tmp_path/'a.nii.gz',tmp_path/'b.nii.gz'
    for path,values in ((a,data),(b,np.roll(data,1,axis=0))):
        im=nib.Nifti1Image(values,np.diag([2.,1.,1.,1.]));im.header.set_xyzt_units('mm');nib.save(im,path)
    metrics,spacing,shape=compare_masks(a,b)
    assert metrics['dice']==2/3 and metrics['iou']==.5 and metrics['hd95']==2
    assert spacing==[2,1,1]
    nib.save(nib.Nifti1Image(np.zeros(shape,np.uint8),nib.load(a).affine,nib.load(a).header),b)
    metrics,_,_=compare_masks(a,b)
    assert metrics['dice']==0 and metrics['hd95'] is None
