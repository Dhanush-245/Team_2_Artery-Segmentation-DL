import { useEffect, useState, type FormEvent } from 'react';
import { apiUrl } from './api';
import EvidenceStatus from './EvidenceStatus';
import { Button } from './components/prismui/button';

type Evaluation = { id: string; provenance: string; reference_sha256: string; prediction_sha256: string;
  metrics: { dice: number | null; iou: number | null; hd95: number | null; assd: number | null }; created_at: string };
type State = { can_evaluate: boolean; source_sha256: string; records: Evaluation[] };
const metric = (value: number | null | undefined, unit = '') => value == null ? 'Undefined (empty mask)' : `${value.toFixed(4)}${unit}`;

export default function VolumeReferenceMetrics({ caseId, runId, token, onSaved }: {
  caseId: string; runId: string; token: string; onSaved: () => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [provenance, setProvenance] = useState('');
  const [study, setStudy] = useState(false);
  const [target, setTarget] = useState(false);
  const [success, setSuccess] = useState('');
  const endpoint = apiUrl(`/api/cases/${caseId}/volumes/analyses/${runId}/reference-metrics`);
  useEffect(() => {
    const controller = new AbortController();
    setState(null); setError('');
    void fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Reference evaluations could not be loaded.'); return response.json(); })
      .then(setState).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [endpoint, token]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !state) return;
    setBusy(true); setError(''); setSuccess('');
    const data = new FormData(); data.append('file', file); data.append('source_sha256', state.source_sha256);
    data.append('provenance', provenance); data.append('same_study_confirmed', String(study)); data.append('same_target_confirmed', String(target));
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Reference evaluation failed. Check the NIfTI mask and confirmations.');
      setState({ ...state, records: [...state.records, result] }); setSuccess('Reference metrics saved for this run.'); onSaved();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  const latest = state?.records.at(-1);
  return <section id="v3d-evaluation" className="v3d-block" aria-label="Model evaluation">
    <p className="eyebrow">MODEL EVALUATION</p><h4>Case reference mask evaluation</h4>
    {error && <p role="alert" className="message error">{error}</p>}
    {!state && !error && <p role="status">Loading saved reference evaluations…</p>}
    {state && !latest && <p>Case-level Dice, IoU and HD95 are unavailable until an eligible reference mask for this exact source volume and target is attached.</p>}
    {latest && <><dl className="volume-summary-grid reference-metric-grid">
      <div><dt>Dice</dt><dd>{metric(latest.metrics.dice)}</dd></div><div><dt>IoU</dt><dd>{metric(latest.metrics.iou)}</dd></div>
      <div><dt>HD95</dt><dd>{metric(latest.metrics.hd95, ' mm')}</dd></div><div><dt>ASSD</dt><dd>{metric(latest.metrics.assd, ' mm')}</dd></div>
    </dl><div className="reference-provenance"><strong>Saved reference</strong><code>{latest.id}</code><p>{latest.provenance}</p></div>
      <p className="caption">Compared with the original saved prediction on its source grid. Reviewer-supplied reference evidence; independent clinical validation is not established. Reviewer-painted versions are separate.</p>
      <details><summary>Saved reference evaluation history ({state?.records.length})</summary>{state?.records.map(item => <p key={item.id}>{item.id} · Dice {metric(item.metrics.dice)} · IoU {metric(item.metrics.iou)} · HD95 {metric(item.metrics.hd95, ' mm')} · {item.provenance}</p>)}</details></>}
    {state?.can_evaluate ? <form onSubmit={submit} className="case-details-form reference-evaluation-form">
      <label>Source-aligned reference mask <input type="file" accept=".nii,.nii.gz" onChange={event => { setFile(event.target.files?.[0] ?? null); setSuccess(''); }} required /></label>
      <p className="caption">Binary NIfTI labels 0 and 1, original shape, affine and millimetre units, up to 32 MiB. No automatic resampling or alignment. Foreground extent is bounded for surface-distance processing.</p>
      <label>Reference provenance <textarea value={provenance} onChange={event => setProvenance(event.target.value)} minLength={10} maxLength={2000} required placeholder="Reference author or dataset, annotation method and eligibility" /></label>
      <label className="reference-confirmation"><input type="checkbox" checked={study} onChange={event => setStudy(event.target.checked)} required />I confirm this reference belongs to the exact source study for this saved run.</label>
      <label className="reference-confirmation"><input type="checkbox" checked={target} onChange={event => setTarget(event.target.checked)} required />I confirm the foreground annotation matches this model’s segmentation target.</label>
      <Button type="submit" disabled={busy || !file || !study || !target || provenance.trim().length < 10}>{busy ? 'Calculating reference metrics…' : 'Calculate and save case metrics'}</Button>
    </form> : state && <p className="caption">A doctor, clinician or administrator with review access can attach the eligible reference mask.</p>}
    {success && <p role="status" className="message success">{success}</p>}
    <EvidenceStatus token={token} compact />
    <p className="caption">The retained ImageCAS validation Dice 0.7937 describes a development cohort of 150 prepared volumes; it is separate from this scan’s reference metrics.</p>
  </section>;
}
