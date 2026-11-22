import { useEffect, useState, type PointerEvent } from "react";
import { Download, Ruler, RotateCcw, Save } from "lucide-react";
import { apiUrl, request } from "./api";
import { toast } from "./lib/toast";

export type Point = [number, number];
type Step = "minimum" | "reference";
export type CaliperState = { minimum: Point[]; reference: Point[]; step: Step };
type SavedRow = { id: string; lesion_id: string; minimum_diameter: number; reference_diameter: number; diameter_unit: string;
  narrowing_percent: number; minimum_diameter_mm: number | null; reference_diameter_mm: number | null;
  independent_of_corovision: boolean; measured_at: string; image_id: string; notes?: string | null };

export const emptyCalipers = (): CaliperState => ({ minimum: [], reference: [], step: "minimum" });
const length = (points: Point[]) => points.length === 2 ? Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) : null;

/** Click layer drawn in the prepared 512 grid, inside the zoomed/panned image stack. */
export function CaliperLayer({ state, onChange }: { state: CaliperState; onChange: (next: CaliperState) => void }) {
  function place(event: PointerEvent<SVGSVGElement>) {
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    const side = Math.min(box.width, box.height);
    const x = ((event.clientX - box.left - (box.width - side) / 2) / side) * 512;
    const y = ((event.clientY - box.top - (box.height - side) / 2) / side) * 512;
    if (x < 0 || y < 0 || x > 512 || y > 512) return;
    const point: Point = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    const current = state[state.step];
    const nextPoints = current.length >= 2 ? [point] : [...current, point];
    const next = { ...state, [state.step]: nextPoints };
    if (state.step === "minimum" && nextPoints.length === 2 && state.reference.length < 2) next.step = "reference";
    onChange(next);
  }
  const line = (points: Point[], color: string, label: string) => points.length ? <g>
    {points.length === 2 && <line x1={points[0][0]} y1={points[0][1]} x2={points[1][0]} y2={points[1][1]} stroke={color} strokeWidth={1.6} />}
    {points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={color} stroke="#000" strokeWidth={0.6} />)}
    {points.length === 2 && <text x={Math.max(points[0][0], points[1][0]) + 5} y={Math.min(points[0][1], points[1][1]) - 4} fill="#fff" fontSize="11" fontWeight="700" style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 3 }}>{label} {length(points)!.toFixed(1)}</text>}
  </g> : null;
  return <svg viewBox="0 0 512 512" preserveAspectRatio="xMidYMid meet" className="caliper-layer" onPointerDown={place}
    role="application" aria-label={`Caliper drawing area. Click two points for the ${state.step === "minimum" ? "minimum lumen diameter" : "reference diameter"}.`}>
    {line(state.minimum, "#ef4444", "MLD")}
    {line(state.reference, "#22c55e", "RVD")}
  </svg>;
}

/** Controls, live result and saved reviewer measurements for one image. */
export function CaliperPanel({ token, caseId, imageId, runId, state, onChange, aiVisible }: {
  token: string; caseId: string; imageId: string; runId?: string; state: CaliperState; onChange: (next: CaliperState) => void; aiVisible: boolean;
}) {
  const [lesion, setLesion] = useState("L1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedRow[]>([]);
  const mld = length(state.minimum), rvd = length(state.reference);
  const estimate = mld != null && rvd != null && rvd > 0 ? ((rvd - mld) / rvd) * 100 : null;

  useEffect(() => {
    let active = true;
    request<SavedRow[]>(`/api/cases/${caseId}/reference-measurements`, token)
      .then(rows => { if (active) setSaved(rows.filter(row => row.image_id === imageId)); }).catch(() => {});
    return () => { active = false; };
  }, [caseId, imageId, token]);

  async function save() {
    if (state.minimum.length !== 2 || state.reference.length !== 2) return;
    setSaving(true);
    try {
      const row = await request<SavedRow>(`/api/cases/${caseId}/reference-measurements`, token, {
        image_id: imageId, analysis_event_id: runId ?? null, lesion_id: lesion.trim(), minimum: state.minimum, reference: state.reference,
        ai_overlay_visible: aiVisible, notes: notes.trim() || null }, "POST");
      setSaved(rows => [...rows, row]);
      onChange({ minimum: [], reference: [], step: "minimum" });
      setNotes("");
      toast.success(`Reference measurement saved for ${row.lesion_id}: ${row.narrowing_percent.toFixed(1)} % narrowing.`);
    } catch (cause) { toast.error((cause as Error).message); } finally { setSaving(false); }
  }
  async function exportCsv() {
    const response = await fetch(apiUrl(`/api/cases/${caseId}/reference-measurements/export.csv`), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { toast.error("Export failed."); return; }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = "reference-measurements.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="caliper-panel" aria-labelledby="caliper-title">
    <div className="caliper-heading"><Ruler size={16} /><h4 id="caliper-title">Reviewer measurement</h4>
      <span className={`caliper-badge ${aiVisible ? "warn" : "ok"}`}>{aiVisible ? "AI overlay visible · not independent" : "Blinded to AI · independent"}</span></div>
    <ol className="caliper-steps">
      <li className={state.step === "minimum" ? "active" : ""}><span className="dot mld" />Click two points across the narrowest lumen (MLD){mld != null && <b> · {mld.toFixed(1)} px</b>}</li>
      <li className={state.step === "reference" ? "active" : ""}><span className="dot rvd" />Click two points across a nearby healthy segment (RVD){rvd != null && <b> · {rvd.toFixed(1)} px</b>}</li>
    </ol>
    <div className="caliper-actions">
      <label>Lesion<input value={lesion} onChange={event => setLesion(event.target.value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40))} /></label>
      <label className="grow">Notes<input value={notes} maxLength={500} onChange={event => setNotes(event.target.value)} placeholder="Optional, no identifiers" /></label>
      <output className="caliper-estimate" aria-live="polite">{estimate == null ? "—" : `${estimate.toFixed(1)} %`}<small>narrowing (preview)</small></output>
      <button type="button" onClick={() => onChange({ minimum: [], reference: [], step: "minimum" })}><RotateCcw size={14} /> Reset</button>
      <button type="button" className="primary" disabled={saving || estimate == null || estimate < 0 || !lesion} onClick={save}><Save size={14} /> Save</button>
    </div>
    {estimate != null && estimate < 0 && <p role="alert" className="caption">The minimum caliper is wider than the reference. Re-measure before saving.</p>}
    <p className="caption">Widths are recomputed on the server in source pixels (and millimetres only when the study records pixel spacing). Turn off AI layers (use Processed with candidates hidden) for an independent reference.</p>
    {saved.length > 0 && <div className="table-scroll"><table><caption>Saved reference measurements for this image</caption>
      <thead><tr><th>Lesion</th><th>MLD</th><th>RVD</th><th>Narrowing</th><th>Independent</th><th>Measured</th></tr></thead>
      <tbody>{saved.map(row => <tr key={row.id}><th scope="row">{row.lesion_id}</th>
        <td>{row.minimum_diameter_mm != null ? `${row.minimum_diameter_mm.toFixed(2)} mm` : `${row.minimum_diameter.toFixed(1)} px`}</td>
        <td>{row.reference_diameter_mm != null ? `${row.reference_diameter_mm.toFixed(2)} mm` : `${row.reference_diameter.toFixed(1)} px`}</td>
        <td>{row.narrowing_percent.toFixed(1)} %</td><td>{row.independent_of_corovision ? "Yes" : "No (AI visible)"}</td>
        <td>{new Date(row.measured_at).toLocaleString()}</td></tr>)}</tbody></table>
      <button type="button" className="caliper-export" onClick={exportCsv}><Download size={14} /> Export case references (CSV)</button></div>}
  </section>;
}
