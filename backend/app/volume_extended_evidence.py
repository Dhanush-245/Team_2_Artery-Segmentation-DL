"""Opt-in source-volume export for reviewed and individually authorized evidence."""
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from threading import BoundedSemaphore
from zipfile import ZIP_STORED, ZipFile

from starlette.responses import FileResponse

from .volume_report_archive import MAX_ARTIFACT_BYTES, encode

SOURCE_MEMBER = 'artifacts/source.nii.gz'
DOWNLOAD_SLOTS = BoundedSemaphore(2)


class ExtendedEvidenceResponse(FileResponse):
    """Release temporary storage even when the client cancels the response."""
    async def __call__(self, scope, receive, send):
        cleanup = self.background
        self.background = None
        try:
            await super().__call__(scope, receive, send)
        finally:
            if cleanup is not None:
                cleanup.func()


def approval_for(user_id, case_id, run_id, version, source_hash):
    """The deployment operator owns this policy file, outside the upload tree."""
    filename = os.getenv('COROVISION_EXTENDED_EVIDENCE_APPROVALS')
    if not filename:
        return None
    try:
        records = json.loads(Path(filename).read_text())
        if not isinstance(records, list):
            return None
        for record in records:
            if not isinstance(record, dict):
                continue
            if (record.get('user_id'), record.get('case_id'), record.get('run_id'),
                    record.get('report_version'), record.get('source_sha256')) != (
                    user_id, case_id, run_id, version, source_hash):
                continue
            if record.get('artifact') != SOURCE_MEMBER or record.get('deidentified') is not True:
                continue
            if not all(isinstance(record.get(key), str) and record[key].strip()
                       for key in ('approval_id', 'license_reference', 'approved_by')):
                continue
            expires = datetime.fromisoformat(record['expires_at'])
            if expires.tzinfo is not None and expires > datetime.now(timezone.utc):
                return record['approval_id']
    except (KeyError, TypeError, ValueError, OSError):
        return None
    return None


def build_extended(standard, source, *, expected_hash, approval_id):
    """Include the byte-identical standard archive and one approved artifact."""
    with ZipFile(standard) as archive:
        identity = json.loads(archive.read('manifest.json'))
    if identity['source_sha256'] != expected_hash:
        raise ValueError('Archived source identity does not match the approval')
    if source.stat().st_size > MAX_ARTIFACT_BYTES or standard.stat().st_size > 2 * MAX_ARTIFACT_BYTES:
        raise ValueError('Extended evidence exceeds the configured size limit')
    with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as temporary:
        path = Path(temporary.name)
    files = []
    try:
        with ZipFile(path, 'w', ZIP_STORED) as archive:
            for name, artifact, limit in (
                ('standard-evidence.zip', standard, 2 * MAX_ARTIFACT_BYTES),
                (SOURCE_MEMBER, source, MAX_ARTIFACT_BYTES),
            ):
                digest = hashlib.sha256()
                total = 0
                with artifact.open('rb') as raw, archive.open(name, 'w') as out:
                    for block in iter(lambda: raw.read(1024 * 1024), b''):
                        total += len(block)
                        if total > limit:
                            raise ValueError('Extended evidence exceeds the configured size limit')
                        digest.update(block)
                        out.write(block)
                files.append(dict(path=name, sha256=digest.hexdigest(), size_bytes=total,
                                  media_type='application/gzip' if name == SOURCE_MEMBER else 'application/zip'))
            if files[-1]['sha256'] != expected_hash:
                raise ValueError('Saved source bytes failed the approval hash check')
            archive.writestr('manifest.json', encode(dict(schema_version='corovision.extended-evidence.v1',
                case_id=identity['case_id'], run_id=identity['run_id'], report=identity['report'],
                snapshot_sha256=identity['snapshot_sha256'], approval_id=approval_id, entries=files)))
        return path
    except BaseException:
        path.unlink(missing_ok=True)
        raise
