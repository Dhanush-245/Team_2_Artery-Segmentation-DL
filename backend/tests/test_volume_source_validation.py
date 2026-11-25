import hashlib
from uuid import uuid4
import nibabel as nib
import numpy as np
from fastapi.testclient import TestClient
from app.main import app, STORAGE
from app.database import SessionLocal
from app.models import VolumeAnalysis
from test_rbac_system import make_user
from test_volume_xai import _volume_run


def test_saved_source_checks_and_identity_denials():
    with TestClient(app) as client:
        _, headers=make_user(f'source-{uuid4().hex}@test.org','doctor')
        _, outsider=make_user(f'outside-{uuid4().hex}@test.org','doctor')
        case,run=_volume_run(client,headers)
        folder=STORAGE/'volumes'/run
        digest=hashlib.sha256((folder/'source.nii.gz').read_bytes()).hexdigest()
        with SessionLocal() as db:
            row=db.get(VolumeAnalysis,run);row.source_sha256=digest;db.commit()
        url=f"/api/cases/{case['id']}/volumes/analyses/{run}/source-validation"
        response=client.get(url,headers=headers)
        assert response.status_code==200,response.text
        assert response.json()['status']=='checked'
        assert response.json()['scope']=='saved_source_grid'
        assert 'not established' in response.json()['detail']
        assert client.get(url,headers=outsider).status_code==404
        mask=folder/'outputs'/'mask_source.nii.gz'
        image=nib.load(mask);affine=image.affine.copy();affine[0,3]+=2
        nib.save(nib.Nifti1Image(np.asarray(image.dataobj),affine,image.header),mask)
        assert client.get(url,headers=headers).status_code==422
        with SessionLocal() as db:
            row=db.get(VolumeAnalysis,run);row.source_sha256='1'*64;db.commit()
        response=client.get(url,headers=headers)
        assert response.status_code==422 and 'hash differs' in response.text
