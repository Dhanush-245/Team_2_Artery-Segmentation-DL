import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, ShieldCheck } from "lucide-react";
import { apiUrl } from "./api";
import { Button } from "./components/prismui/button";
import { utcDate } from "./lib/time";

type Target = { task: "stenosis" | "segmentation"; target_id: string; model_score?: number | null; bbox_prepared_xyxy?: number[] | null };
type Verification = { status: string; deletion: string; insertion: string; randomization: string; randomization_note?: string; randomization_protocol?: string;
  metrics?: Record<string, number>; error?: string; completed_at?: string };
type XaiRecord = { id: string; status: string; error?: string; method_label: string; created_at: string; completed_at?: string;
  identity: { task: string; target_id: string; method: string; method_version: string; checkpoint_sha256: string; source_sha256: string; run_id: string; target_definition_version: string };
  parameters: { constrained: boolean }; target: { definition: string; target_score?: number; match_iou?: number | null; target_layer?: string; roi_pixels?: number };
  summary?: { energy_inside_target_mask?: number; peak_inside_target_mask?: boolean; nonzero_fraction?: number };
  artifact_sha256?: Record<string, string>; verification: Verification };
type Evidence = { id: string; date: string; method: string; cohort: string; overall: string; checks: Record<string, string>[];
  randomization?: string; randomization_note?: string; deletion_insertion?: string; deletion_insertion_note?: string };
type Overview = { state: string; reason?: string; zero_candidates: boolean; targets: Target[]; methods: Record<string, string[]>;
  method_versions: Record<string, string>; target_definitions: Record<string, string>; checkpoints: Record<string, string>;
  can_generate: boolean; records: XaiRecord[]; study_evidence: Evidence[]; model_version: string; engine_version: string };
type Measurement = { candidate_id: string; status: string; minimum_diameter?: number | null; reference_diameter?: number | null;
  narrowing_percent?: number | null; unit?: string; reasons?: string[]; severity?: { category?: string | null; status?: string; reason?: string } };

const METHOD_LABEL: Record<string, string> = { gradcam: "Grad-CAM", gradcampp: "Grad-CAM++", occlusion: "Occlusion sensitivity" };
const STATUS_TONE: Record<string, string> = { ready: "ok", generating: "info", failed: "bad", not_evaluable: "warn", PASS: "ok", FAIL: "bad", PARTIAL: "warn", NOT_TESTED: "muted", NOT_EVALUABLE: "warn" };
const short = (value?: string) => value ? `${value.slice(0, 12)}…` : "—";
const targetLabel = (t: { task: string; target_id: string }) => t.task === "segmentation" ? "Vessel segmentation (predicted vessel mask)" : `Stenosis candidate ${t.target_id}`;

function Chip({ value }: { value: string }) {
  return <span className={`cv-chip ${STATUS_TONE[value] ?? "muted"}`}>{value.replaceAll("_", " ")}</span>;
}

function useAuthImage(url: string | null, token: string) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    setSrc("");
    if (!url) return;
    let revoked = "";
    const controller = new AbortController();
    fetch(apiUrl(url), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error("unavailable"); return r.blob(); })
      .then(blob => { revoked = URL.createObjectURL(blob); setSrc(revoked); })
      .catch(() => undefined);
    return () => { controller.abort(); if (revoked) URL.revokeObjectURL(revoked); };
  }, [url, token]);
  return src;
}

function ComparisonTile({ base, record, token }: { base: string; record: XaiRecord; token: string }) {
  const src = useAuthImage(record.status === "ready" ? `${base}/explanations/${record.id}/overlay.png` : null, token);
  return <figure className="xai-compare-tile">
    {src ? <img src={src} alt={`${record.method_label} for ${targetLabel(record.identity)}`} /> : <div className="xai-compare-empty">{record.status.replaceAll("_", " ")}</div>}
    <figcaption><strong>{record.method_label}</strong><span>Deletion <Chip value={record.verification?.deletion ?? "NOT_TESTED"} /> Insertion <Chip value={record.verification?.insertion ?? "NOT_TESTED"} /></span></figcaption>
  </figure>;
}

/** Per-case Explainable AI for one saved 2D run: real targets, on-demand methods, saved evidence. */
export default function CaseXaiPanel({ token, caseId, runId, preparedUrl }: { token: string; caseId: string; runId: string; preparedUrl: string }) {
  const base = `/api/cases/${caseId}/xai/${runId}`;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [target, setTarget] = useState("");
  const [method, setMethod] = useState("gradcam");
  const [constrained, setConstrained] = useState(false);
  const [opacity, setOpacity] = useState(70);
  const [showOutline, setShowOutline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const current = useRef(runId);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(apiUrl(base), { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) throw new Error(response.status === 404 ? "This saved run is not available to you." : "Explanations could not be loaded.");
    const body: Overview = await response.json();
    if (current.current === runId) setOverview(body);
    return body;
  }, [base, token, runId]);

  useEffect(() => {
    current.current = runId;
    setOverview(null); setError(""); setTarget(""); setMeasurements([]);
    const controller = new AbortController();
    load(controller.signal).then(body => {
      const first = body.targets[0];
      if (first) setTarget(`${first.task}:${first.target_id}`);
    }).catch(cause => { if ((cause as Error).name !== "AbortError") setError((cause as Error).message); });
    fetch(apiUrl(`/api/cases/${caseId}/automatic-measurements/${runId}`), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(r => r.ok ? r.json() : []).then((rows: { records?: Measurement[] }[]) => setMeasurements(rows[0]?.records ?? [])).catch(() => undefined);
    return () => controller.abort();
  }, [caseId, runId, token, load]);

  const pending = overview?.records.some(r => r.status === "generating" || r.verification?.status === "running");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { load().catch(() => undefined); }, 3000);
    return () => clearInterval(timer);
  }, [pending, load]);

  const [task, targetId] = target.split(":") as ["stenosis" | "segmentation", string];
  const selectedTarget = overview?.targets.find(t => t.task === task && t.target_id === targetId);
  const effectiveConstrained = task === "stenosis" && method !== "occlusion" && constrained;
  const record = useMemo(() => overview?.records.find(r => r.identity.task === task && r.identity.target_id === targetId
    && r.identity.method === method && r.parameters.constrained === effectiveConstrained), [overview, task, targetId, method, effectiveConstrained]);
  const targetRecords = overview?.records.filter(r => r.identity.task === task && r.identity.target_id === targetId) ?? [];
  const heatmap = useAuthImage(record?.status === "ready" ? `${base}/explanations/${record.id}/heatmap.png` : null, token);
  const measurement = task === "stenosis" ? measurements.find(m => m.candidate_id === targetId) : undefined;

  async function post(path: string, body?: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch(apiUrl(path), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.detail || "The request could not be completed."); }
      await load();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  if (error && !overview) return <section className="xai-panel" id="case-xai"><p role="alert" className="message error">{error}</p></section>;
  if (!overview) return <section className="xai-panel" id="case-xai"><p role="status"><Loader2 size={16} className="spin" /> Loading explanations…</p></section>;

  const bbox = selectedTarget?.bbox_prepared_xyxy;
  return <section className="xai-panel" id="case-xai" aria-labelledby="case-xai-title">
    <div className="viewer-heading">
      <div className="cv-panel-head"><span className="eyebrow">EXPLAINABLE AI · THIS SAVED RUN</span><h3 id="case-xai-title">Why did the model predict this?</h3>
        <p className="muted">Attribution for one real target of this run, generated on the frozen release model and saved with its identity and hashes.</p></div>
      <span className="cv-chip info">Research only</span>
    </div>
    <dl className="xai-identity">
      <div><dt>Run</dt><dd>{runId.slice(0, 8)}</dd></div>
      <div><dt>Model release</dt><dd>{overview.model_version}</dd></div>
      <div><dt>Detector checkpoint</dt><dd title={overview.checkpoints.stenosis}>{short(overview.checkpoints.stenosis)}</dd></div>
      <div><dt>Segmentation checkpoint</dt><dd title={overview.checkpoints.syntax}>{short(overview.checkpoints.syntax)}</dd></div>
      <div><dt>State</dt><dd><Chip value={overview.state} /></dd></div>
    </dl>
    {overview.state !== "ELIGIBLE" && <p className="message warning">{overview.reason}</p>}
    {overview.zero_candidates && <p className="message warning">This run retained no stenosis candidate, so no candidate-specific heatmap exists. Segmentation explanations remain available. No detection does not mean normal arteries.</p>}

    <div className="xai-layout">
      <div className="xai-viewport" aria-label="Prepared image with attribution overlay">
        {preparedUrl ? <img src={preparedUrl} alt="Prepared angiogram for this run" /> : <div className="xai-compare-empty">Prepared image unavailable</div>}
        {heatmap && <img className="xai-heat" src={heatmap} alt={`${record?.method_label} attribution for ${targetLabel({ task, target_id: targetId })}`} style={{ opacity: opacity / 100 }} />}
        {showOutline && bbox && <svg className="xai-outline" viewBox="0 0 512 512" aria-hidden="true"><rect x={bbox[0]} y={bbox[1]} width={bbox[2] - bbox[0]} height={bbox[3] - bbox[1]} /></svg>}
        {!heatmap && record?.status === "ready" && <span className="xai-viewport-note">Loading attribution…</span>}
        {!record && <span className="xai-viewport-note">Not generated for this target and method</span>}
      </div>
      <div className="xai-controls">
        <label>Explanation target<select value={target} onChange={e => setTarget(e.target.value)}>
          {overview.targets.map(t => <option key={`${t.task}:${t.target_id}`} value={`${t.task}:${t.target_id}`}>{targetLabel(t)}{t.model_score != null ? ` · raw score ${t.model_score.toFixed(3)}` : ""}</option>)}
        </select></label>
        <label>Method<select value={method} onChange={e => setMethod(e.target.value)}>
          {(overview.methods[task] ?? []).map(m => <option key={m} value={m}>{METHOD_LABEL[m]} · {overview.method_versions[m]}</option>)}
        </select></label>
        {task === "stenosis" && method !== "occlusion" && <label className="xai-check"><input type="checkbox" checked={constrained} onChange={e => setConstrained(e.target.checked)} /> Limit to the candidate's predicted mask</label>}
        <label>Overlay opacity · {opacity}%<input type="range" min={0} max={100} value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></label>
        {task === "stenosis" && <label className="xai-check"><input type="checkbox" checked={showOutline} onChange={e => setShowOutline(e.target.checked)} /> Show candidate box</label>}
        <div className="cv-actions">
          {record?.status === "ready" ? <span className="cv-chip ok">Saved explanation</span> : record?.status === "generating" ? <span role="status"><Loader2 size={14} className="spin" /> Generating…</span> : null}
          {overview.can_generate && (!record || record.status === "failed") && <Button size="sm" className="primary" disabled={busy} onClick={() => post(`${base}/explanations`, { task, target_id: targetId, method, constrained: effectiveConstrained })}>
            <Play size={14} /> {busy ? "Working…" : method === "occlusion" ? "Run occlusion (about a minute)" : "Generate explanation"}</Button>}
          {!overview.can_generate && !record && <span className="caption">Generating needs analysis or review access to this case.</span>}
        </div>
        <p className="caption">{overview.target_definitions[task]}.</p>
        <p className="caption xai-legend"><span className="xai-ramp" aria-hidden="true" /> Low → high attribution, normalized per map. Bright areas are not lesion labels, severity or disease probability.</p>
        {error && <p role="alert" className="message error">{error}</p>}
      </div>
    </div>

    {record && <div className="xai-grid">
      <article className="xai-card">
        <h4>Target and provenance</h4>
        {record.status !== "ready" && record.error && <p className="message warning">{record.error}</p>}
        <dl className="xai-facts">
          <div><dt>Target</dt><dd>{targetLabel(record.identity)}</dd></div>
          <div><dt>Method</dt><dd>{record.method_label} · {record.identity.method_version}</dd></div>
          {record.target.target_layer && <div><dt>Layer</dt><dd>{record.target.target_layer}</dd></div>}
          {record.target.target_score != null && <div><dt>Target value</dt><dd>{record.target.target_score.toFixed(4)}{task === "segmentation" ? " (mean logit)" : " (raw detector score)"}</dd></div>}
          {record.target.match_iou != null && <div><dt>Re-identified at mask IoU</dt><dd>{record.target.match_iou}</dd></div>}
          {record.summary?.energy_inside_target_mask != null && <div><dt>Energy inside target mask</dt><dd>{Math.round(record.summary.energy_inside_target_mask * 100)}%{record.parameters.constrained ? " (forced by the constraint)" : ""}</dd></div>}
          <div><dt>Image SHA-256</dt><dd title={record.identity.source_sha256}>{short(record.identity.source_sha256)}</dd></div>
          <div><dt>Heatmap SHA-256</dt><dd title={record.artifact_sha256?.map}>{short(record.artifact_sha256?.map)}</dd></div>
          <div><dt>Saved</dt><dd>{utcDate(record.completed_at ?? record.created_at).toLocaleString()}</dd></div>
        </dl>
      </article>
      <article className="xai-card">
        <h4><ShieldCheck size={15} aria-hidden="true" /> Faithfulness for this target</h4>
        <dl className="xai-facts">
          <div><dt>Deletion</dt><dd><Chip value={record.verification?.deletion ?? "NOT_TESTED"} />{record.verification?.metrics && <span className="caption"> advantage {record.verification.metrics.deletion_auc_advantage?.toFixed(3)}</span>}</dd></div>
          <div><dt>Insertion</dt><dd><Chip value={record.verification?.insertion ?? "NOT_TESTED"} />{record.verification?.metrics && <span className="caption"> advantage {record.verification.metrics.insertion_auc_advantage?.toFixed(3)}</span>}</dd></div>
          <div><dt>Model randomization</dt><dd><Chip value={record.verification?.randomization ?? "NOT_TESTED"} /></dd></div>
        </dl>
        {record.verification?.randomization_note && <p className="caption">Randomization: {record.verification.randomization_note}</p>}
        <p className="caption">Deletion/insertion (protocol corovision-forward-occlusion-v1): 8×8 cells, image-mean baseline, ranked order against one fixed random order; each advantage must be ≥ 0.01. Model randomization: the same map recomputed on a fully randomized copy of the model must have |Spearman ρ| ≤ 0.2. A visible heatmap is not evidence of faithfulness.</p>
        {record.verification?.status === "running" ? <p role="status"><Loader2 size={14} className="spin" /> Faithfulness checks running…</p>
          : record.status === "ready" && overview.can_generate && (record.verification?.status !== "completed" || (!record.verification?.randomization_protocol && record.identity.method !== "occlusion"))
            && <Button size="sm" variant="outline" disabled={busy} onClick={() => post(`${base}/explanations/${record.id}/verification`)}>{record.verification?.status === "completed" ? "Add model-randomization check" : "Run faithfulness checks"}</Button>}
        {record.verification?.error && <p className="message warning">{record.verification.error}</p>}
      </article>
      {task === "stenosis" && <article className="xai-card">
        <h4>Measurement and severity rationale</h4>
        {!measurement ? <p className="muted">No saved automatic measurement for this candidate yet. Open Severity Review to assess it.</p> : <dl className="xai-facts">
          <div><dt>Status</dt><dd>{measurement.status.replaceAll("_", " ")}</dd></div>
          <div><dt>MLD / RVD</dt><dd>{measurement.minimum_diameter != null && measurement.reference_diameter != null ? `${measurement.minimum_diameter.toFixed(2)} / ${measurement.reference_diameter.toFixed(2)} ${measurement.unit ?? "source px"}` : "Not measured"}</dd></div>
          <div><dt>Narrowing</dt><dd>{measurement.narrowing_percent != null ? `${measurement.narrowing_percent.toFixed(1)}% = (1 − MLD / RVD) × 100` : "Not reported"}</dd></div>
          <div><dt>Research severity</dt><dd>{measurement.severity?.category ?? `Withheld${measurement.severity?.reason ? ` · ${measurement.severity.reason}` : ""}`}</dd></div>
          {!!measurement.reasons?.length && <div><dt>Quality notes</dt><dd>{measurement.reasons.map(r => r.replaceAll("_", " ")).join("; ")}</dd></div>}
        </dl>}
        <p className="caption">Measurements come from saved vessel geometry, not from the heatmap. Source-pixel widths are not millimetres without calibration.</p>
      </article>}
    </div>}

    {targetRecords.length > 1 && <div className="xai-compare">
      <p className="cv-subtitle">Method comparison · {targetLabel({ task, target_id: targetId })}</p>
      <div className="xai-compare-row">{targetRecords.map(r => <ComparisonTile key={r.id} base={base} record={r} token={token} />)}</div>
    </div>}

    <details className="evidence-details">
      <summary>Saved explanations for this run ({overview.records.length})</summary>
      {overview.records.length === 0 ? <p className="muted">Nothing generated yet.</p> : <div className="table-scroll"><table>
        <thead><tr><th>Target</th><th>Method</th><th>Status</th><th>Deletion</th><th>Insertion</th><th>Saved</th></tr></thead>
        <tbody>{overview.records.map(r => <tr key={r.id}><td>{targetLabel(r.identity)}</td><td>{r.method_label}</td><td><Chip value={r.status} /></td>
          <td><Chip value={r.verification?.deletion ?? "NOT_TESTED"} /></td><td><Chip value={r.verification?.insertion ?? "NOT_TESTED"} /></td><td>{utcDate(r.created_at).toLocaleString()}</td></tr>)}</tbody>
      </table></div>}
    </details>
    <details className="evidence-details">
      <summary>Study-level faithfulness evidence (not specific to this run)</summary>
      {overview.study_evidence.map(item => <div key={item.id} className="xai-study">
        <p><strong>{item.date} · {item.method}</strong> · {item.cohort} · overall <Chip value={item.overall} /></p>
        <ul>{item.checks.map((check, i) => <li key={i}>{check.target}: {Object.entries(check).filter(([k]) => k !== "target").map(([k, v]) => `${k} ${v}`).join(", ")}</li>)}</ul>
        {item.randomization_note && <p className="caption">Randomization {item.randomization}: {item.randomization_note}</p>}
        {item.deletion_insertion_note && <p className="caption">Deletion/insertion {item.deletion_insertion}: {item.deletion_insertion_note}</p>}
      </div>)}
    </details>
  </section>;
}
