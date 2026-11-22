import { useCallback, useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { apiUrl } from "./api";
import { Button } from "./components/prismui/button";
import { utcDate } from "./lib/time";

type VolumeRecord = { id: string; status: string; error?: string; method_label: string; created_at: string; completed_at?: string;
  identity: { method: string; method_version: string; checkpoint_sha256: string; source_sha256: string };
  target: { definition: string; target_score?: number; target_layer?: string; roi_voxels?: number };
  alignment?: { status: string; mask_dice_vs_saved?: number; native_shape?: number[] };
  summary?: { energy_inside_target_mask?: number | null; peak_inside_target_mask?: boolean };
  artifact_sha256?: { native?: string };
  verification: { status: string; deletion: string; insertion: string; randomization: string; metrics?: Record<string, number>; error?: string } };
type Overview = { state: string; reason?: string; model_id: string; checkpoint_sha256?: string; methods: string[];
  method_versions: Record<string, string>; target: { definition: string }; can_generate: boolean; records: VolumeRecord[] };

const LABEL: Record<string, string> = { gradcam: "Grad-CAM 3D", gradcampp: "Grad-CAM++ 3D", occlusion: "Occlusion sensitivity 3D" };
const TONE: Record<string, string> = { ready: "ok", PASS: "ok", FAIL: "bad", generating: "info", failed: "bad", not_evaluable: "warn", NOT_TESTED: "muted", ELIGIBLE: "ok", UNSUPPORTED: "warn", UNAVAILABLE: "warn" };
const Chip = ({ value }: { value: string }) => <span className={`cv-chip ${TONE[value] ?? "muted"}`}>{value.replaceAll("_", " ")}</span>;

/** Volumetric explanation of one saved 3D run; the chosen ready record is overlaid in the slice viewer. */
export default function VolumeXaiPanel({ token, caseId, runId, onShow }: { token: string; caseId: string; runId: string; onShow: (id: string | undefined, label?: string) => void }) {
  const base = `/api/cases/${caseId}/volumes/analyses/${runId}/xai`;
  const [data, setData] = useState<Overview | null>(null);
  const [method, setMethod] = useState("gradcam");
  const [shown, setShown] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(apiUrl(base), { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) throw new Error("Volumetric explanations could not be loaded.");
    setData(await response.json());
  }, [base, token]);

  useEffect(() => {
    setData(null); setShown(undefined); onShow(undefined);
    const controller = new AbortController();
    load(controller.signal).catch(cause => { if ((cause as Error).name !== "AbortError") setError((cause as Error).message); });
    return () => controller.abort();
  }, [load, onShow]);

  const pending = data?.records.some(r => r.status === "generating" || r.verification?.status === "running");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { load().catch(() => undefined); }, 4000);
    return () => clearInterval(timer);
  }, [pending, load]);

  const record = data?.records.find(r => r.identity.method === method);
  useEffect(() => {
    const next = record?.status === "ready" ? record.id : undefined;
    if (next !== shown) { setShown(next); onShow(next, record?.method_label); }
  }, [record, shown, onShow]);

  async function post(path: string, body?: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch(apiUrl(path), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.detail || "The request could not be completed."); }
      await load();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  if (!data) return <section className="xai-panel volume-xai">{error ? <p role="alert" className="message error">{error}</p> : <p role="status"><Loader2 size={14} className="spin" /> Loading volumetric explanations…</p>}</section>;
  return <section className="xai-panel volume-xai" aria-labelledby="volume-xai-title">
    <div className="viewer-heading">
      <div className="cv-panel-head"><span className="eyebrow">EXPLAINABLE AI · 3D</span><h4 id="volume-xai-title">Volumetric attribution of the vessel segmentation</h4>
        <p className="muted">Computed on the retained 3D model for this run and shown on the native slices below.</p></div>
      <Chip value={data.state} />
    </div>
    {data.state !== "ELIGIBLE" && <p className="message warning">{data.reason}</p>}
    <div className="cv-actions">
      <label className="volume-xai-method">Method<select value={method} onChange={e => setMethod(e.target.value)}>
        {data.methods.map(m => <option key={m} value={m}>{LABEL[m]} · {data.method_versions[m]}</option>)}</select></label>
      {record?.status === "ready" && <span className="cv-chip ok">Shown on slices</span>}
      {record?.status === "generating" && <span role="status"><Loader2 size={14} className="spin" /> Generating ({method === "occlusion" ? "about 10 minutes" : "under a minute"})…</span>}
      {data.can_generate && (!record || record.status === "failed") && <Button size="sm" className="primary" disabled={busy} onClick={() => post(`${base}/explanations`, { method })}><Play size={14} /> Generate</Button>}
      {!data.can_generate && data.state === "ELIGIBLE" && !record && <span className="caption">Generating needs 3D analysis or review access to this case.</span>}
    </div>
    <p className="caption">{data.target.definition}. Bright areas are where that segmentation output was sensitive, not lesions, narrowing or disease.</p>
    {error && <p role="alert" className="message error">{error}</p>}
    {record && record.status !== "generating" && <div className="xai-grid">
      <article className="xai-card">
        <h4>Target, alignment and provenance</h4>
        {record.error && <p className="message warning">{record.error}</p>}
        <dl className="xai-facts">
          <div><dt>Method</dt><dd>{record.method_label} · {record.identity.method_version}</dd></div>
          {record.target.target_layer && <div><dt>Layer</dt><dd>{record.target.target_layer}</dd></div>}
          {record.target.target_score != null && <div><dt>Target value</dt><dd>{record.target.target_score.toFixed(3)} (mean vessel logit margin, {record.target.roi_voxels} voxels at 128³)</dd></div>}
          {record.alignment && <div><dt>Native-grid alignment</dt><dd><Chip value={record.alignment.status} /> mask Dice vs saved {record.alignment.mask_dice_vs_saved ?? "—"}{record.alignment.native_shape ? ` · ${record.alignment.native_shape.join(" × ")}` : ""}</dd></div>}
          {record.summary?.energy_inside_target_mask != null && <div><dt>Energy inside target voxels</dt><dd>{Math.round(record.summary.energy_inside_target_mask * 1000) / 10}% · peak {record.summary.peak_inside_target_mask ? "inside" : "outside"}</dd></div>}
          <div><dt>Checkpoint</dt><dd title={record.identity.checkpoint_sha256}>{record.identity.checkpoint_sha256.slice(0, 12)}…</dd></div>
          <div><dt>Attribution SHA-256</dt><dd title={record.artifact_sha256?.native}>{record.artifact_sha256?.native ? `${record.artifact_sha256.native.slice(0, 12)}…` : "—"}</dd></div>
          <div><dt>Saved</dt><dd>{utcDate(record.completed_at ?? record.created_at).toLocaleString()}</dd></div>
        </dl>
      </article>
      <article className="xai-card">
        <h4>Faithfulness for this target</h4>
        <dl className="xai-facts">
          <div><dt>Deletion</dt><dd><Chip value={record.verification?.deletion ?? "NOT_TESTED"} />{record.verification?.metrics && <span className="caption"> advantage {record.verification.metrics.deletion_auc_advantage?.toFixed(3)}</span>}</dd></div>
          <div><dt>Insertion</dt><dd><Chip value={record.verification?.insertion ?? "NOT_TESTED"} />{record.verification?.metrics && <span className="caption"> advantage {record.verification.metrics.insertion_auc_advantage?.toFixed(3)}</span>}</dd></div>
          <div><dt>Model randomization</dt><dd><Chip value={record.verification?.randomization ?? "NOT_TESTED"} /></dd></div>
        </dl>
        <p className="caption">4×4×4 blocks of the model input, volume-mean baseline, ranked against one fixed random order; scores relative to the unperturbed target; each advantage must be ≥ 0.01. About 260 model passes.</p>
        {record.verification?.status === "running" ? <p role="status"><Loader2 size={14} className="spin" /> Deletion/insertion running…</p>
          : record.status === "ready" && data.can_generate && record.verification?.status !== "completed" && <Button size="sm" variant="outline" disabled={busy} onClick={() => post(`${base}/explanations/${record.id}/verification`)}>Run deletion/insertion check</Button>}
        {record.verification?.error && <p className="message warning">{record.verification.error}</p>}
      </article>
    </div>}
  </section>;
}
