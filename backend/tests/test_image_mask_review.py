"""2D correction/reference API acceptance on synthetic saved artifacts, never expert evidence."""
import base64
import hashlib
from io import BytesIO
from uuid import uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image as Raster
from app.database import SessionLocal
from app.main import app, STORAGE
from app.models import AnalysisEvent, Image
from test_rbac_system import make_user


def png(data):
    out=BytesIO();Raster.fromarray(data).save(out,'PNG');return out.getvalue()


def saved_image(client, headers):
    cid=client.post('/api/cases',headers=headers,json={'case_code':'MASK-TEST-'+uuid4().hex}).json()['id']
    source=png(np.full((80,96),100,np.uint8))
    im=client.post(f'/api/cases/{cid}/images',headers=headers,files={'file':('synthetic.png',source,'image/png')}).json()
    with SessionLocal() as db:
        # Known-truth artifact is already on the source grid (no preprocessing transform).
        db.get(Image,im['id']).preprocessing_config_json='{}'
        event=AnalysisEvent(image_id=im['id'],model_version='synthetic-known-truth',artery_pixels=400,stenosis_pixels=0,overlay_path=str(STORAGE/'mask-tests'/f'{uuid4().hex}.png'))
        db.add(event);db.commit();db.refresh(event);eid=event.id
        from pathlib import Path
        mask=Path(event.overlay_path).with_name(eid+'.artery_mask.png');mask.parent.mkdir(exist_ok=True)
        a=np.zeros((80,96),np.uint8);a[20:40,20:40]=255;mask.write_bytes(png(a))
    return cid,im['id'],eid,mask,source


def test_versions_survive_reopen_and_original_is_immutable():
    with TestClient(app) as c:
        user,h=make_user(f'mask-{uuid4().hex}@test.org','doctor')
        cid,i,e,path,_=saved_image(c,h);original=path.read_bytes()
        url=f'/api/images/{i}/analyses/{e}/mask-review'
        listing=c.get(url,headers=h).json();assert (listing['width'],listing['height'])==(96,80)
        body=dict(original_sha256=listing['original_sha256'],edits=[dict(x=0,y=0,foreground=True),dict(x=20,y=20,foreground=False)],note='Synthetic correction')
        r=c.post(url,headers=h,json=body);assert r.status_code==201,r.text
        first=r.json();assert first['reviewer_id']==user['id'] and not first['clinical_validated']
        downloaded=c.get(url+'/'+first['id']+'.png',headers=h);assert downloaded.status_code==200
        arr=np.asarray(Raster.open(BytesIO(downloaded.content)));assert arr[0,0]==255 and arr[20,20]==0
        second=c.post(url,headers=h,json={**body,'edits':[dict(x=1,y=1,foreground=True)]}).json()
        arr=np.asarray(Raster.open(BytesIO(c.get(url+'/'+second['id']+'.png',headers=h).content)))
        assert arr[0,0]==0 and arr[20,20]==255 # each immutable version derives from original
        assert path.read_bytes()==original
    with TestClient(app) as c:
        assert [v['id'] for v in c.get(url,headers=h).json()['versions']]==[first['id'],second['id']]
        assert c.get(url+'/not-a-version.png',headers=h).status_code==404


def test_edit_failures_leave_no_version_and_retry_succeeds():
    with TestClient(app) as c:
        _,h=make_user(f'mask-errors-{uuid4().hex}@test.org','doctor')
        _,i,e,path,_=saved_image(c,h);url=f'/api/images/{i}/analyses/{e}/mask-review'
        body=dict(original_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),edits=[dict(x=0,y=0,foreground=True)],note='Synthetic retry')
        for override,status in [({'original_sha256':'0'*64},409),({'edits':[]},422),({'note':''},422),({'edits':[dict(x=-1,y=0,foreground=True)]},422),({'edits':[dict(x=96,y=0,foreground=True)]},422)]:
            assert c.post(url,headers=h,json={**body,**override}).status_code==status
            assert c.get(url,headers=h).json()['versions']==[]
        assert c.post(url,headers=h,json=body).status_code==201
        assert len(c.get(url,headers=h).json()['versions'])==1


@pytest.mark.parametrize('role',['admin','clinician','researcher','technician','viewer','ml_engineer'])
def test_role_ceiling_and_read_grant_cannot_be_upgraded(role):
    with TestClient(app) as c:
        _,h=make_user(f'mask-owner-{uuid4().hex}@test.org','doctor')
        u,rh=make_user(f'mask-{role}-{uuid4().hex}@test.org',role)
        cid,i,e,path,source=saved_image(c,h);url=f'/api/images/{i}/analyses/{e}/mask-review'
        body=dict(original_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),edits=[dict(x=0,y=0,foreground=True)],note='Synthetic role test')
        ref=dict(image_sha256=hashlib.sha256(source).hexdigest(),mask_png_base64=base64.b64encode(path.read_bytes()).decode(),provenance='Synthetic role check only',same_frame_confirmed=True)
        assert c.get(url).status_code==401
        if role=='ml_engineer':
            assert c.get(url,headers=rh).status_code in (403,404);return
        assert c.post(f'/api/cases/{cid}/access',headers=h,json={'user_email_or_id':u['email'],'access_level':'read'}).status_code==201
        assert c.get(url,headers=rh).status_code==200
        for endpoint,payload in [(url,body),(url+'/reference-metrics',ref)]:
            assert c.post(endpoint,headers=rh,json=payload).status_code==403
        assert c.post(f'/api/cases/{cid}/access',headers=h,json={'user_email_or_id':u['email'],'access_level':'review'}).status_code==201
        expected=201 if role in ('admin','clinician') else 403
        assert c.post(url,headers=rh,json=body).status_code==expected
        expected=200 if role in ('admin','clinician') else 403
        assert c.post(url+'/reference-metrics',headers=rh,json=ref).status_code==expected


def test_reference_validation_retry_and_source_grid_metrics():
    with TestClient(app) as c:
        _,h=make_user(f'mask-ref-{uuid4().hex}@test.org','doctor')
        _,i,e,path,source=saved_image(c,h);original=path.read_bytes();url=f'/api/images/{i}/analyses/{e}/mask-review/reference-metrics'
        body=dict(image_sha256=hashlib.sha256(source).hexdigest(),mask_png_base64=base64.b64encode(original).decode(),provenance='Synthetic self-reference; not independent expert validation',same_frame_confirmed=True)
        folder=path.parent/(e+'.references')
        for extra in [dict(image_sha256='0'*64),dict(same_frame_confirmed=False),dict(mask_png_base64='invalid!'),dict(mask_png_base64=base64.b64encode(png(np.full((80,96),7,np.uint8))).decode()),dict(mask_png_base64=base64.b64encode(png(np.zeros((10,10),np.uint8))).decode())]:
            assert c.post(url,headers=h,json={**body,**extra}).status_code==422
            assert not list(folder.glob('*.json'))
        r=c.post(url,headers=h,json=body);assert r.status_code==200,r.text
        record=r.json();assert record['metrics']['dice']==record['metrics']['iou']==1
        assert record['metrics']['hd95']==0 and record['metrics']['distance_unit']=='pixel'
        assert record['independent_validation'] is False and path.read_bytes()==original
        import json
        assert json.loads((folder/(record['id']+'.json')).read_text())==record


def test_cross_image_event_and_outsider_are_denied():
    with TestClient(app) as c:
        _,h=make_user(f'mask-pair-{uuid4().hex}@test.org','doctor');_,other=make_user(f'mask-out-{uuid4().hex}@test.org','doctor')
        _,i,e,path,_=saved_image(c,h);_,j,f,_,_=saved_image(c,h)
        url=f'/api/images/{i}/analyses/{e}/mask-review';assert c.get(url,headers=other).status_code==404
        assert c.get(f'/api/images/{j}/analyses/{e}/mask-review',headers=h).status_code==404
        path.unlink();assert c.get(url,headers=h).status_code==404
