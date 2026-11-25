"""Disposable reference-upload browser fixture; no inference or production storage.

Run from the repository root with PYTHONPATH=backend. Keep the private directory
outside the checkout. Stop with Ctrl+C; reuse the same directory to test restart.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--port', type=int, default=8010)
    args = parser.parse_args()
    root = (args.directory or Path(tempfile.mkdtemp(prefix='coro-reference-'))).resolve()
    # Refuse accidental use of any checkout or pre-existing application data.
    checkout = Path(__file__).resolve().parents[2]
    if root == checkout or checkout in root.parents:
        parser.error('Use a private disposable directory outside the checkout')
    fixture = root / 'fixture.json'
    if root.exists() and any(root.iterdir()) and not fixture.is_file():
        parser.error('Directory must be empty or contain this harness fixture')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    private = json.loads(fixture.read_text()) if fixture.exists() else {
        'fixture_schema': 'corovision.reference-browser.synthetic.v1',
        'base_url': f'http://127.0.0.1:{args.port}',
        'email': f'acceptance-{secrets.token_hex(8)}@example.org',
        'password': secrets.token_urlsafe(24), 'jwt_secret': secrets.token_urlsafe(48),
    }
    if private.get('fixture_schema') != 'corovision.reference-browser.synthetic.v1':
        parser.error('Unrecognized fixture directory')
    if private['base_url'] != f'http://127.0.0.1:{args.port}':
        parser.error('Restart with the original fixture port')
    os.environ.update(DATABASE_URL='sqlite:///' + str(root / 'test.db'),
        STORAGE_DIR=str(root / 'storage'), JWT_SECRET=private['jwt_secret'],
        COROVISION_MODEL_PROVIDER='legacy', COROVISION_INFERENCE_WORKER='0',
        CV_CASE_VISIBILITY='assigned')
    from fastapi.testclient import TestClient
    import nibabel as nib
    import numpy as np
    from app.main import app, STORAGE
    from app.database import SessionLocal
    from app.models import VolumeAnalysis
    from test_rbac_system import make_user
    from test_volume_xai import _volume_run
    if 'run_id' not in private:
        with TestClient(app) as client:
            _, headers = make_user(private['email'], 'doctor', password=private['password'])
            case, run = _volume_run(client, headers)
            folder = STORAGE / 'volumes' / run
            source = folder / 'source.nii.gz'
            mask = folder / 'outputs' / 'mask_source.nii.gz'
            image = nib.load(source)
            data = np.zeros(image.shape, np.uint8)
            data[3:9, 3:9, 2:6] = 1
            nib.save(nib.Nifti1Image(data, image.affine, image.header), mask)
            (root / 'reference.nii.gz').write_bytes(mask.read_bytes())
            (root / 'invalid.nii.gz').write_bytes(b'invalid NIfTI software fixture')
            with SessionLocal() as db:
                row = db.get(VolumeAnalysis, run)
                row.input_kind = 'synthetic_fixture'
                row.source_sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
                result = json.loads(row.result_json)
                result.update(model_id='SYNTHETIC_KNOWN_TRUTH_NOT_MODEL_INFERENCE',
                    duration_seconds=0, source_shape=list(image.shape),
                    source_affine_ras_mm=image.affine.tolist(),
                    coarse_foreground_voxels=int(data.sum()), slices=[],
                    limitations=['Synthetic saved artifacts; no patient or expert data.'])
                row.result_json = json.dumps(result)
                db.commit()
            private.update(case_id=case['id'], run_id=run)
            fixture.write_text(json.dumps(private, indent=2))
            fixture.chmod(0o600)
    print(f'Disposable synthetic fixture: {fixture}', flush=True)
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=args.port)


if __name__ == '__main__':
    main()
