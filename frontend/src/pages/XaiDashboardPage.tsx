import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { apiUrl } from "../api";
import { Card } from "../components/prismui/card";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { utcDate } from "../lib/time";

type Row = { case_id: string; case_code: string; image_id: string; run_id: string; record_id: string; task: string; target_id: string;
  method: string; method_label: string; constrained: boolean; status: string; deletion: string; insertion: string; randomization: string;
  energy_inside_target_mask?: number | null; created_at: string };
type Summary = { engine_version: string; method_versions: Record<string, string>; target_definitions: Record<string, string>;
  coverage: { runs: number; eligible_runs: number; zero_candidate_runs: number; runs_with_explanations: number };
  by_method: Record<string, { records: number; ready: number; verified: number; deletion_pass: number; insertion_pass: number }>;
  records: Row[]; study_evidence: { id: string; date: string; method: string; cohort: string; overall: string; checks: Record<string, string>[];
    randomization_note?: string; deletion_insertion_note?: string; randomization?: string; deletion_insertion?: string }[];
  volume_xai: string; scope: string;
  volume?: { runs: number; records: { case_id: string; case_code: string; run_id: string; record_id: string; method_label: string; status: string; alignment: string; deletion: string; insertion: string; created_at: string }[] } };

const TONE: Record<string, string> = { ready: "ok", PASS: "ok", FAIL: "bad", PARTIAL: "warn", NOT_TESTED: "muted", NOT_EVALUABLE: "warn", failed: "bad", generating: "info", not_evaluable: "warn", NOT_IMPLEMENTED: "muted" };
const Chip = ({ value }: { value: string }) => <span className={`cv-chip ${TONE[value] ?? "muted"}`}>{value.replaceAll("_", " ")}</span>;

/** Research-wide XAI coverage and verification across the cases this user can open. */
export default function XaiDashboardPage() {
  const { token } = useWorkspace();
  const navigate = useNavigate();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [method, setMethod] = useState("all");
  const [verification, setVerification] = useState("all");

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl("/api/xai/summary"), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error("The XAI summary could not be loaded."); return r.json(); })
      .then(setData).catch(cause => { if ((cause as Error).name !== "AbortError") setError((cause as Error).message); });
    return () => controller.abort();
  }, [token]);

  const rows = useMemo(() => (data?.records ?? []).filter(r => (method === "all" || r.method_label === method)
    && (verification === "all" || (verification === "verified" ? r.deletion !== "NOT_TESTED" : r.deletion === "NOT_TESTED"))), [data, method, verification]);

  if (error) return <div className="settings-page"><p role="alert" className="message error">{error}</p></div>;
  if (!data) return <div className="settings-page"><p role="status"><Loader2 size={16} className="spin" /> Loading explanation records…</p></div>;
  const c = data.coverage;
  return <div className="settings-page xai-dashboard">
    <div className="page-heading"><div><p className="eyebrow">RESEARCH EVIDENCE</p><h2>Explainable AI</h2></div><span className="stage-badge">Research only</span></div>
    <p className="muted">Coverage, methods and verification of saved case explanations. Each explanation belongs to one case, run and target; open a row to see it in its case. {data.scope}</p>

    <Card className="panel">
      <div className="cv-panel-head"><span className="eyebrow">COVERAGE</span><h3>Saved 2D analysis runs</h3></div>
      <dl className="xai-identity">
        <div><dt>Runs you can open</dt><dd>{c.runs}</dd></div>
        <div><dt>Eligible for explanation</dt><dd>{c.eligible_runs}</dd></div>
        <div><dt>Runs with saved explanations</dt><dd>{c.runs_with_explanations}</dd></div>
        <div><dt>Runs with no stenosis candidate</dt><dd>{c.zero_candidate_runs}</dd></div>
        <div><dt>Completed 3D runs</dt><dd>{data.volume?.runs ?? 0}</dd></div>
        <div><dt>Saved 3D explanations</dt><dd>{data.volume?.records.length ?? 0}</dd></div>
      </dl>
      <p className="caption">Ineligible runs used an earlier model release or a non-XCA image; their saved maps stay as they were. Zero-candidate runs offer segmentation explanations only.</p>
    </Card>

    <Card className="panel">
      <div className="cv-panel-head"><span className="eyebrow">METHODS</span><h3>Saved explanations by method</h3><p className="muted">Counts of saved records only. Deletion/insertion is run per target on request; pass counts are not pooled across different cohorts.</p></div>
      {Object.keys(data.by_method).length === 0 ? <p className="muted">No explanations saved yet. Generate one from a case's Explainable AI step.</p> : <div className="table-scroll"><table>
        <thead><tr><th>Method</th><th>Version</th><th>Saved</th><th>Ready</th><th>Verified</th><th>Deletion PASS</th><th>Insertion PASS</th></tr></thead>
        <tbody>{Object.entries(data.by_method).map(([label, m]) => {
          const key = ({ "Grad-CAM": "gradcam", "Grad-CAM++": "gradcampp", "Occlusion sensitivity": "occlusion" } as Record<string, string>)[label.split(" (")[0]];
          return <tr key={label}><td>{label}</td><td>{key ? data.method_versions[key] : "—"}</td><td>{m.records}</td><td>{m.ready}</td><td>{m.verified}</td><td>{m.verified ? `${m.deletion_pass} of ${m.verified}` : "—"}</td><td>{m.verified ? `${m.insertion_pass} of ${m.verified}` : "—"}</td></tr>;
        })}</tbody>
      </table></div>}
    </Card>

    <Card className="panel">
      <div className="cv-panel-head"><span className="eyebrow">EVIDENCE INVENTORY</span><h3>Saved explanations</h3></div>
      <div className="workbench-selectors">
        <label>Method<select value={method} onChange={e => setMethod(e.target.value)}><option value="all">All methods</option>{[...new Set(data.records.map(r => r.method_label))].map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Verification<select value={verification} onChange={e => setVerification(e.target.value)}><option value="all">All</option><option value="verified">Deletion/insertion run</option><option value="untested">Not tested</option></select></label>
      </div>
      {rows.length === 0 ? <p className="muted">No saved explanations match.</p> : <div className="table-scroll"><table>
        <thead><tr><th>Case</th><th>Run</th><th>Target</th><th>Method</th><th>Status</th><th>Deletion</th><th>Insertion</th><th>Randomization</th><th>Saved</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.record_id}>
          <td><button type="button" className="cv-link-button" onClick={() => navigate(`/analysis?case_id=${r.case_id}&image_id=${r.image_id}&run_id=${r.run_id}`)}>{r.case_code}</button></td>
          <td>{r.run_id.slice(0, 8)}</td><td>{r.task === "segmentation" ? "Vessel mask" : r.target_id}</td><td>{r.method_label}</td>
          <td><Chip value={r.status} /></td><td><Chip value={r.deletion} /></td><td><Chip value={r.insertion} /></td><td><Chip value={r.randomization} /></td>
          <td>{utcDate(r.created_at).toLocaleString()}</td></tr>)}</tbody>
      </table></div>}
    </Card>

    <Card className="panel">
      <div className="cv-panel-head"><span className="eyebrow">3D CTA</span><h3>Saved volumetric explanations</h3></div>
      {!data.volume?.records.length ? <p className="muted">No volumetric explanation saved yet. Generate one from a 3D case's analysis view.</p> : <div className="table-scroll"><table>
        <thead><tr><th>Case</th><th>Run</th><th>Method</th><th>Status</th><th>Alignment</th><th>Deletion</th><th>Insertion</th><th>Saved</th></tr></thead>
        <tbody>{data.volume.records.map(r => <tr key={r.record_id}>
          <td><button type="button" className="cv-link-button" onClick={() => navigate(`/analysis?case_id=${r.case_id}`)}>{r.case_code}</button></td>
          <td>{r.run_id.slice(0, 8)}</td><td>{r.method_label}</td><td><Chip value={r.status} /></td><td><Chip value={r.alignment} /></td>
          <td><Chip value={r.deletion} /></td><td><Chip value={r.insertion} /></td><td>{utcDate(r.created_at).toLocaleString()}</td></tr>)}</tbody>
      </table></div>}
    </Card>

    <Card className="panel">
      <div className="cv-panel-head"><span className="eyebrow">VERIFICATION STUDIES</span><h3>Study-level faithfulness results</h3><p className="muted">Recorded experiments on the frozen detector. Historical results are shown as recorded, including failures.</p></div>
      {data.study_evidence.map(item => <div key={item.id} className="xai-study">
        <p><strong>{item.date} · {item.method}</strong> · {item.cohort} · overall <Chip value={item.overall} /></p>
        <div className="table-scroll"><table><thead><tr><th>Target / map</th><th>Result</th></tr></thead>
          <tbody>{item.checks.map((check, i) => <tr key={i}><td>{check.target}</td><td>{Object.entries(check).filter(([k]) => k !== "target").map(([k, v]) => <span key={k}>{k} <Chip value={v} /> </span>)}</td></tr>)}</tbody></table></div>
        {item.randomization_note && <p className="caption">Randomization {item.randomization?.replaceAll("_", " ")}: {item.randomization_note}</p>}
        {item.deletion_insertion_note && <p className="caption">Deletion/insertion {item.deletion_insertion}: {item.deletion_insertion_note}</p>}
      </div>)}
    </Card>

    <Card className="panel">
      <div className="cv-panel-head"><span className="eyebrow">DEFINITIONS</span><h3>Targets and limits</h3></div>
      <ul className="xai-definitions">
        <li><strong>Stenosis candidate:</strong> {data.target_definitions.stenosis}.</li>
        <li><strong>Segmentation:</strong> {data.target_definitions.segmentation}.</li>
        <li>Engine {data.engine_version}. Heatmaps show where a model target was sensitive, not lesion labels, severity or disease probability. Technical generation and scientific faithfulness are separate results; clinical validity is not assessed.</li>
        <li><strong>3D CTA:</strong> mean vessel-minus-background logit over the voxels the retained 3D U-Net labels as vessel at 128³, explained at decoder block dec[1] and restored to the native grid through the saved mask's affine path. Each record carries an alignment check against the saved mask.</li>
      </ul>
    </Card>
  </div>;
}
