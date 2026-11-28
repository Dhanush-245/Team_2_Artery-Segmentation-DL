"""Publish completed report versions atomically and read the archived export bytes."""
import csv
import hashlib
import json
import mimetypes
import os
import tempfile
from io import StringIO
from pathlib import PurePosixPath
from threading import BoundedSemaphore
from typing import Annotated, Literal
from zipfile import ZIP_DEFLATED, ZipFile

from pydantic import BaseModel, ConfigDict, Field

from .volume_reporting import csv_text, pdf_bytes

SCHEMA = 'corovision.volume-report.v2'
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
REPORT_SLOTS = BoundedSemaphore(1)


Sha256 = Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]


class ReportIdentity(BaseModel):
    id: str
    version: Annotated[int, Field(ge=1)]
    generated_at: str
    review_status: str


class SourceVolume(BaseModel):
    model_config = ConfigDict(extra='allow')
    id: Sha256
    sha256: Sha256
    shape_ijk: list[int] | None
    affine_ras_mm: list[list[float]] | None
    coordinate_system: Literal['RAS']
    format: str | None
    verification_status: str


class EvidenceFile(BaseModel):
    path: str
    size_bytes: Annotated[int, Field(ge=0)]
    sha256: Sha256
    media_type: str


class VolumeReportSchema(BaseModel):
    """Versioned envelope. Nested algorithm records retain their original schemas."""
    model_config = ConfigDict(extra='allow')
    schema_version: Literal['corovision.volume-report.v2']
    case_id: str
    analysis_run_id: str
    source_sha256: Sha256
    model_id: str
    checkpoint_sha256: str | None
    report: ReportIdentity
    stages: dict
    segmentation: dict
    source_volume: SourceVolume
    experimental_geometry: dict | None = None
    explainable_ai: list
    reference_evaluations: list
    review_history: list
    mask_review_versions: list
    evidence_files: dict[str, EvidenceFile]
    evidence_status: dict[str, str]
    snapshot_sha256: Sha256


def encode(value):
    return json.dumps(value, sort_keys=True, allow_nan=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def cell(value):
    if value is None:
        return ''
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, (dict, list)):
        value = encode(value).decode()
    text = str(value)
    return "'" + text if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')) else text


def csv_tables(document):
    geometry = document.get('experimental_geometry') or {}
    candidates = geometry.get('candidates', [])
    tables = {
        'case_summary': ([document], ('source_sha256', 'model_id', 'checkpoint_sha256', 'input_kind', 'source_shape', 'evidence_status')),
        'stenosis_candidates': (candidates, ('id', 'path_id', 'location_ras_mm', 'minimum_diameter_mm', 'reference_diameter_mm',
            'narrowing_percent', 'minimum_area_mm2', 'reference_area_mm2', 'area_narrowing_percent', 'severity',
            'protocol_id', 'uncertainty_status', 'abstention_reasons')),
        'vessel_paths': (geometry.get('paths', []), ('id', 'component_id', 'length_mm')),
        'severity_assessments': (candidates, ('id', 'path_id', 'severity', 'protocol_id', 'uncertainty_status', 'abstention_reasons')),
        'lumen_measurements': ([
            {**section, 'candidate_id': candidate['id'], 'path_id': candidate['path_id'], 'section': role}
            for candidate in candidates
            for role, section in zip(('minimum', 'proximal_reference', 'distal_reference'), candidate.get('cross_sections') or [])
        ], ('candidate_id', 'path_id', 'section', 'center_ras_mm', 'step_mm', 'area_mm2', 'equivalent_diameter_mm', 'status')),
        'model_evaluation': ([{**r, **r['metrics']} for r in document['reference_evaluations']],
            ('id', 'dice', 'iou', 'hd95', 'assd', 'prediction_sha256', 'reference_sha256', 'provenance')),
        'xai_evidence': (document['explainable_ai'], ('id','method_label','target','status','verification','artifact_sha256')),
        'review_history': (document['review_history'], ('path_id','decision','reviewed_at','reviewer_role','notes','measurement')),
    }
    result = {}
    for name, (rows, columns) in tables.items():
        stream = StringIO()
        writer = csv.writer(stream)
        writer.writerow(('schema_version','case_id','run_id','report_id','report_version','review_status',
                         'measurement_method', *columns))
        for row in rows:
            writer.writerow(map(cell, (SCHEMA, document['case_id'], document['analysis_run_id'],
                document['report']['id'], document['report']['version'], document['report']['review_status'],
                geometry.get('method'), *(row.get(key) for key in columns))))
        result[f'csv/{name}.csv'] = stream.getvalue().encode()
    return result


def report_path(folder, version):
    return folder / 'report-versions' / f'{version}.zip'


def version_numbers(folder):
    folder = folder / 'report-versions'
    return sorted(int(path.stem) for path in folder.glob('*.zip') if path.stem.isdecimal())


def package(folder, document, artifacts, version, generated_at):
    destination = report_path(folder, version)
    destination.parent.mkdir(parents=True, exist_ok=True)
    document = {**document, 'schema_version': SCHEMA}
    document['report'] = dict(id=f"{document['analysis_run_id']}-v{version}", version=version, generated_at=generated_at,
        review_status=document.pop('review_status'))
    document['evidence_files'] = {name: describe(name, data) for name, data in artifacts.items()}
    document['artifacts'] = document['evidence_files']
    document.pop('snapshot_sha256', None)
    document['snapshot_sha256'] = digest(encode(document))
    VolumeReportSchema.model_validate(document)
    members = {**artifacts, **csv_tables(document), 'analysis.json': encode(document),
        'report-schema.json': encode(VolumeReportSchema.model_json_schema()),
        'geometry.json': encode(document.get('experimental_geometry')),
        'measurements.csv': csv_text(document).encode(),
        'report.pdf': pdf_bytes(document, artifacts)}
    if sum(map(len, members.values())) > 2 * MAX_ARTIFACT_BYTES:
        raise ValueError('Report exceeds the bounded archive size')
    manifest = dict(case_id=document['case_id'], run_id=document['analysis_run_id'], report=document['report'],
        schema_version=SCHEMA, source_sha256=document['source_sha256'], snapshot_sha256=document['snapshot_sha256'],
        files={name: digest(data) for name, data in members.items()},
        entries=[describe(name, data) for name, data in members.items()],
        unavailable=document['evidence_status'])
    with tempfile.NamedTemporaryFile(dir=destination.parent) as temporary:
        with ZipFile(temporary, 'w', ZIP_DEFLATED) as archive:
            for name, data in members.items():
                path = PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts or '\\' in name:
                    raise ValueError('Invalid evidence entry')
                archive.writestr(name, data)
            archive.writestr('manifest.json', encode(manifest))
        temporary.flush()
        with ZipFile(temporary.name) as archive:
            if set(archive.namelist()) != members.keys() | {'manifest.json'} or any(
                digest(archive.read(name)) != expected for name, expected in manifest['files'].items()
            ):
                raise ValueError('Evidence archive verification failed')
        try:
            os.link(temporary.name, destination)
        except FileExistsError:
            return False
    return True


def describe(name, data):
    return dict(path=name, size_bytes=len(data), sha256=digest(data),
                media_type=mimetypes.guess_type(name)[0] or 'application/octet-stream')


def read_member(path, name, case_id, run_id, version):
    with ZipFile(path) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        if (manifest['case_id'], manifest['run_id'], manifest['report']['version']) != (case_id, run_id, version):
            raise ValueError('Report identity mismatch')
        if name is None:
            if set(archive.namelist()) != manifest['files'].keys() | {'manifest.json'}:
                raise ValueError('Evidence inventory mismatch')
            for member, expected in manifest['files'].items():
                with archive.open(member) as stream:
                    if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                        raise ValueError('Evidence artifact integrity check failed')
            return None
        data = archive.read(name)
        if digest(data) != manifest['files'][name]:
            raise ValueError('Report integrity check failed')
        return data
