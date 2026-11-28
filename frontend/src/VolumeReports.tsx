import { useEffect, useState } from 'react';
import { apiUrl } from './api';
import { Button } from './components/prismui/button';

type Report = {
  report: { id: string; version: number; generated_at: string; review_status: string };
  evidence_status: Record<string, string>;
  evidence_files: Record<string, { size_bytes: number; sha256: string }>;
  snapshot_sha256: string;
};

export default function VolumeReports({ endpoint, token, runId, caseId }: {
  endpoint: string; token: string; runId: string; caseId: string;
}) {
  const [versions, setVersions] = useState<number[]>([]);
  const [version, setVersion] = useState(1);
  const [record, setRecord] = useState<Report>();
  const [preview, setPreview] = useState<{ url: string; page: number; total: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl(endpoint + '/report-versions'), {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Saved report versions are unavailable.');
      const data: { versions: number[] } = await response.json();
      setVersions(data.versions);
      setVersion(data.versions.at(-1) ?? 1);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [endpoint, token]);

  const hasVersion = versions.includes(version);
  useEffect(() => {
    setRecord(undefined);
    if (!hasVersion) return;
    const controller = new AbortController();
    fetch(apiUrl(`${endpoint}/report/json?version=${version}`), {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Saved report verification failed.');
      const data: Report = await response.json();
      if (!controller.signal.aborted) setRecord(data);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [endpoint, token, version, hasVersion]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function request(path: string, method = 'GET') {
    const response = await fetch(apiUrl(endpoint + path), {
      method, headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(typeof data?.detail === 'string' ? data.detail : 'Report request failed.');
    }
    return response;
  }

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const { version: created } = await (await request('/report-versions', 'POST')).json() as { version: number };
      setVersions(values => [...new Set([...values, created])].sort((a, b) => a - b));
      setPreview(undefined);
      setVersion(created);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function open(format: 'pdf' | 'csv' | 'json' | 'zip') {
    setBusy(true);
    setError('');
    try {
      const path = format === 'zip' ? '/evidence.zip' : `/report/${format}`;
      const response = await request(`${path}?version=${version}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `volume-${runId}-v${version}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (!hasVersion) setVersions(values => [...new Set([...values, version])]);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function showPreview(page: number) {
    setBusy(true);
    setError('');
    try {
      const response = await request(`/report-preview.png?version=${version}&page=${page}`);
      if (!hasVersion) setVersions(values => [...new Set([...values, version])]);
      const url = URL.createObjectURL(await response.blob());
      setPreview({ url, page, total: Number(response.headers.get('X-Report-Pages')) || 1 });
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="volume-card" aria-labelledby="volume-report-title">
    <h4 id="volume-report-title">Reports &amp; exports</h4>
    <p>Case {caseId} · Saved run {runId} · Research use</p>
    <label>Saved report version{' '}
      <select disabled={busy || versions.length === 0} value={version} onChange={event => { setPreview(undefined); setVersion(Number(event.target.value)); }}>
        {!hasVersion && <option value={version}>Version {version} · awaiting first export</option>}
        {versions.map(value => <option key={value} value={value}>Version {value}</option>)}
      </select>
    </label>
    {record && <p>Generated {new Date(record.report.generated_at).toLocaleString()} · Review {record.report.review_status.replaceAll('_', ' ')}</p>}
    <div className="cv-actions" role="group" aria-label="3D research report exports">
      <Button size="sm" disabled={busy} onClick={() => void showPreview(1)}>Preview PDF</Button>
      {(['pdf', 'csv', 'json', 'zip'] as const).map(format =>
        <Button key={format} variant="outline" size="sm" disabled={busy} onClick={() => void open(format)}>
          {format === 'zip' ? 'Evidence ZIP' : format.toUpperCase()}
        </Button>)}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void generate()}>Generate new version</Button>
    </div>
    {busy && <p role="status">Preparing report…</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <div>
      <div className="cv-actions" role="group" aria-label="PDF preview pages">
        <Button variant="outline" size="sm" disabled={busy || preview.page <= 1} onClick={() => void showPreview(preview.page - 1)}>Previous page</Button>
        <span>Page {preview.page} of {preview.total}</span>
        <Button variant="outline" size="sm" disabled={busy || preview.page >= preview.total} onClick={() => void showPreview(preview.page + 1)}>Next page</Button>
        <Button variant="outline" size="sm" onClick={() => setPreview(undefined)}>Close preview</Button>
      </div>
      <img src={preview.url} alt={`Report version ${version}, page ${preview.page}`} style={{ maxWidth: '100%', width: '48rem', height: 'auto' }} />
    </div>}
    {record && <details>
      <summary>Advanced export details</summary>
      <p>Verified snapshot · {record.report.id}</p>
      <p style={{ overflowWrap: 'anywhere' }}>SHA-256 {record.snapshot_sha256}</p>
      <ul>{Object.entries(record.evidence_status).map(([key, value]) =>
        <li key={key}>{key.replaceAll('_', ' ')} · {value}</li>)}</ul>
      <ul>{Object.entries(record.evidence_files).map(([name, value]) =>
        <li key={name} style={{ overflowWrap: 'anywhere' }}>{name} · {value.size_bytes} bytes · {value.sha256}</li>)}</ul>
    </details>}
  </section>;
}
