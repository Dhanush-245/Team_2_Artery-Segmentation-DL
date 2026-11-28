import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Download, Loader2 } from "lucide-react";
import { apiUrl } from "./api";
import { pathLabel, pointOnPath, positionOnPath } from "./lib/candidateNavigation";
import { WINDOW_PRESETS } from "./VolumeMprViewer";

export type GeometryPath = { id: string; length_mm: number; points_ras_mm: number[][]; mask_width_mm: number[] };
type Estimate = { path_id: string; narrowing_percent: number };
type Site = { position_mm: number; mask_width_mm: number; section_diameter_mm: number | null };
type Review = { id: string; path_id: string; decision: string; artery: string | null; notes: string | null; reviewer_role: string; reviewed_at: string;
  measurement: null | { minimum: Site; reference: Site; minimum_diameter_mm: number; reference_diameter_mm: number; narrowing_percent: number; diameter_method: string } };
type Listing = { current: Review[]; history: Review[]; can_review: boolean; arteries: string[] };
type Props = { caseId: string; runId: string; token: string; paths: GeometryPath[]; estimates: Estimate[]; maskSha256?: string; onSaved: () => void; focusPathId?: string; focusNonce?: number; candidatePathIds?: string[]; candidateLocation?: number[]; candidatePathId?: string; onPathSelect?: (id: string) => void; onLocate?: (ras: number[], pathId: string) => void };

const PROFILE_HEIGHT = 70;
/** Server default half-width (mm) across the vessel; the CPR image is 2 × this tall. */
const CPR_HALF_WIDTH_MM = 10;
const CPR_DISPLAY_HEIGHT_PX = 280;
const label = (value: string) => value.replaceAll("_", " ");

/** Cumulative arc length (mm) at each saved centreline point. */
function arcLengths(points: number[][]) {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) out.push(out[i - 1] + Math.hypot(...points[i].map((v, a) => v - points[i - 1][a])));
  return out;
}

function WidthProfile({ path, minimum, reference, onPick }: { path: GeometryPath; minimum: number | null; reference: number | null; onPick: (mm: number) => void }) {
  const arc = useMemo(() => arcLengths(path.points_ras_mm), [path]);
  const top = Math.max(1, ...path.mask_width_mm);
  const x = (mm: number) => (mm / Math.max(path.length_mm, 1e-6)) * 1000;
  const y = (w: number) => PROFILE_HEIGHT - (w / top) * (PROFILE_HEIGHT - 8);
  const line = path.mask_width_mm.map((w, i) => `${x(arc[i]).toFixed(1)},${y(w).toFixed(1)}`).join(" ");
  const pick = (event: MouseEvent<SVGSVGElement>) => { const box = event.currentTarget.getBoundingClientRect(); onPick(((event.clientX - box.left) / box.width) * path.length_mm); };
  return <svg className="volume-cpr-profile" viewBox={`0 0 1000 ${PROFILE_HEIGHT}`} preserveAspectRatio="none" onClick={pick} role="img"
    aria-label={`Mask width along ${path.id}: up to ${top.toFixed(1)} mm over ${path.length_mm.toFixed(1)} mm`}>
    <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    {minimum != null && <line className="marker-minimum" x1={x(minimum)} x2={x(minimum)} y1={0} y2={PROFILE_HEIGHT} vectorEffect="non-scaling-stroke" />}
    {reference != null && <line className="marker-reference" x1={x(reference)} x2={x(reference)} y1={0} y2={PROFILE_HEIGHT} vectorEffect="non-scaling-stroke" />}
  </svg>;
}

/** Straightened view along one saved path, with reviewer accept/reject, artery label and lumen markers. */
export default function VolumeCprReview({ caseId, runId, token, paths, estimates, maskSha256, onSaved, focusPathId, focusNonce, candidatePathIds = [], candidateLocation, candidatePathId, onPathSelect, onLocate }: Props) {
  const ordered = useMemo(() => {
    const narrowing = new Map(estimates.map(row => [row.path_id, row.narrowing_percent]));
    return [...paths].sort((a, b) => Number(candidatePathIds.includes(b.id)) - Number(candidatePathIds.includes(a.id)) || (narrowing.get(b.id) ?? -1) - (narrowing.get(a.id) ?? -1) || b.length_mm - a.length_mm);
  }, [paths, estimates, candidatePathIds]);
  const narrowing = useMemo(() => new Map(estimates.map(row => [row.path_id, row.narrowing_percent])), [estimates]);
  const [pathId, setPathId] = useState(ordered[0]?.id ?? "");
  useEffect(() => { if (focusPathId && ordered.some(item => item.id === focusPathId)) setPathId(focusPathId); }, [focusPathId, focusNonce, ordered]);
  const path = ordered.find(item => item.id === pathId) ?? ordered[0];
  const [rotation, setRotation] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [opacity, setOpacity] = useState(.15);
  const [win, setWin] = useState(800);
  const [level, setLevel] = useState(300);
  const [image, setImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [placing, setPlacing] = useState<"minimum" | "reference">("minimum");
  const [minimum, setMinimum] = useState<number | null>(null);
  const [reference, setReference] = useState<number | null>(null);
  const [decision, setDecision] = useState("accept");
  const [artery, setArtery] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const current = useRef("");
  const base = `/api/cases/${caseId}/volumes/analyses/${runId}`;
  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ path_id: path.id, rotation: String(rotation), window: String(win), level: String(level), opacity: String(opacity) });
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch(apiUrl(`${base}/cpr.png?${query}`), { headers: auth, signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? "The saved source, mask or path is not available." : "This reformation could not be rendered.");
        const url = URL.createObjectURL(await response.blob());
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = url; setImage(url);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError((cause as Error).message);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [base, auth, path, rotation, win, level, opacity]);
  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);

  const loadReviews = useMemo(() => async () => {
    const response = await fetch(apiUrl(`${base}/geometry-review`), { headers: auth });
    if (response.ok) setListing(await response.json());
  }, [base, auth]);
  useEffect(() => { void loadReviews(); }, [loadReviews]);
  useEffect(() => {
    const saved = listing?.current.find(row => row.path_id === path?.id);
    setMinimum(saved?.measurement?.minimum.position_mm ?? null);
    setReference(saved?.measurement?.reference.position_mm ?? null);
    setDecision(saved?.decision ?? 'uncertain'); setArtery(saved?.artery ?? '');
    setNotes(saved?.notes ?? ''); setPlacing('minimum');
  }, [path?.id, listing]);
  useEffect(() => { setMessage(''); }, [pathId]);

  if (!path) return null;
  const candidatePosition = candidateLocation && candidatePathId === path.id ? positionOnPath(path.points_ras_mm, candidateLocation) : null;
  const place = (mm: number) => {
    const ras = pointOnPath(path.points_ras_mm, mm);
    if (ras) onLocate?.(ras, path.id);
    if (!listing?.can_review) return;
    const value = Math.round(Math.min(Math.max(mm, 0), path.length_mm) * 10) / 10;
    if (placing === "minimum") { setMinimum(value); setPlacing("reference"); } else { setReference(value); setPlacing("minimum"); }
  };
  const pickOnImage = (event: MouseEvent<HTMLImageElement>) => { const box = event.currentTarget.getBoundingClientRect(); place(((event.clientX - box.left) / box.width) * path.length_mm); };
  const save = async () => {
    setSaving(true); setMessage("");
    const markers = minimum != null && reference != null && decision !== "reject";
    const body = { path_id: path.id, mask_sha256: maskSha256, decision, artery: artery || null, notes: notes.trim() || null,
      minimum_position_mm: markers ? minimum : null, reference_position_mm: markers ? reference : null };
    try {
      const response = await fetch(apiUrl(`${base}/geometry-review`), { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : Array.isArray(result.detail) ? result.detail[0]?.msg ?? "Review could not be saved." : "Review could not be saved.");
      setMessage(result.measurement ? `Saved · reviewer narrowing ${result.measurement.narrowing_percent.toFixed(1)}%` : "Saved");
      setNotes(""); await loadReviews(); onSaved();
    } catch (cause) { setMessage((cause as Error).message); } finally { setSaving(false); }
  };
  const marker = (mm: number | null, kind: string) => mm == null ? null : <i className={`volume-cpr-marker ${kind}`} style={{ left: `${(mm / path.length_mm) * 100}%` }} aria-hidden="true" />;
  const preset = WINDOW_PRESETS.find(p => p.window === win && p.level === level)?.id ?? "custom";
  const frameWidth = expanded ? "100%" : `min(100%, ${Math.round(CPR_DISPLAY_HEIGHT_PX * path.length_mm / (2 * CPR_HALF_WIDTH_MM))}px)`;

  return <section className="volume-mpr volume-cpr" aria-labelledby="volume-cpr-title">
    <div className="volume-mpr-heading">
      <div><span className="eyebrow">CURVED PLANAR REFORMATION</span><h4 id="volume-cpr-title">Straightened vessel along one extracted path</h4></div>
      <label className="volume-cpr-path">Path <select value={path.id} onChange={event => { setPathId(event.target.value); onPathSelect?.(event.target.value); }}>
        {ordered.map(item => <option key={item.id} value={item.id}>{candidatePathIds.includes(item.id) ? "Candidate · " : "Exploratory · "}{pathLabel(item.id)} · {item.length_mm.toFixed(1)} mm{narrowing.has(item.id) ? ` · exploratory width ${narrowing.get(item.id)?.toFixed(0)}%` : ""}</option>)}
      </select></label>
    </div>
    <p className="caption">{candidatePathIds.includes(path.id) ? 'This path contains a strict geometry candidate. Its perpendicular-section measurements are shown separately below.' : 'Exploratory path: no strict geometry candidate is established on this path. The width estimate is not a validated stenosis measurement.'} Cyan = predicted vessel mask; grayscale = sampled CT.</p>
    {candidatePathId && path.id !== candidatePathId && <p className="volume-cpr-context-warning" role="status"><strong>Different path in CPR.</strong> Measurements and severity still refer to {pathLabel(candidatePathId)}; this CPR is showing {pathLabel(path.id)}. Choose the matching candidate path to reconnect the views.</p>}
    <div className="volume-mpr-controls"><button type="button" className="lv-goto" onClick={() => setOpacity(opacity === 0 ? .15 : 0)}>{opacity === 0 ? 'Show predicted mask' : 'View CT without overlay'}</button></div>
    <div className={`volume-cpr-stage${expanded ? " volume-cpr-expanded" : ""}`}>
      <div className="volume-cpr-frame" style={{ width: frameWidth }}>
        {image && <img src={image} onClick={pickOnImage} alt={`Straightened reformation of ${path.id}, ${path.length_mm.toFixed(1)} mm long, rotated ${rotation} degrees; predicted mask in cyan`} />}
        {marker(candidatePosition, "candidate")}{marker(minimum, "minimum")}{marker(reference, "reference")}
      </div>
      {loading && <span className="volume-mpr-busy" role="status"><Loader2 size={16} className="spin" /> Rendering</span>}
      {error && <p role="alert" className="volume-mpr-error">{error}</p>}
    </div>
    <h5>Vessel width profile along the selected path</h5>
    <div className="volume-cpr-profile-frame" style={{ width: frameWidth }}><WidthProfile path={path} minimum={minimum} reference={reference} onPick={place} /></div>
    <div className="cpr-axis" style={{ width: frameWidth }}><span>Start · 0 mm</span><span>Distance along path</span><span>{path.length_mm.toFixed(1)} mm · End</span></div>
    <p className="caption">Width profile above: predicted-mask width (mm). Cross-path image span: 20 mm. Enlarging the display cannot recover detail absent from the source or prediction.</p>
    <details className="volume-method-notes"><summary>Advanced CPR display controls</summary>
    <label>Display proportions <select value={expanded ? 'expanded' : 'physical'} onChange={event => setExpanded(event.target.value === 'expanded')}><option value="expanded">Expand path to panel width</option><option value="physical">Preserve physical proportions</option></select></label>
    <p className="caption">{expanded ? 'Horizontal display is expanded for inspection; image proportions are not a physical scale. ' : 'Physical proportions preserved. ' }All measurements use saved 3D coordinates. Path length: {path.length_mm.toFixed(1)} mm long.</p>
    <p className="caption">Left = path start, right = end ({path.length_mm.toFixed(1)} mm); the curve shows the predicted-mask width along the path. Click the image or the curve to place the <strong>{placing}</strong> marker.</p>
    <div className="volume-mpr-controls">
      <label className="volume-mpr-opacity"><span>Rotation · {rotation}°</span><input type="range" min={0} max={165} step={15} value={rotation} onChange={event => setRotation(Number(event.target.value))} aria-label="Rotation about the vessel axis" /></label>
      <label>Mask overlay {Math.round(opacity * 100)}%<input aria-label="CPR mask overlay opacity" type="range" min="0" max=".8" step=".05" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></label>
      <label>Preset <select value={preset} onChange={event => { const p = WINDOW_PRESETS.find(item => item.id === event.target.value); if (p) { setWin(p.window); setLevel(p.level); } }}>
        {WINDOW_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}{preset === "custom" && <option value="custom">Custom</option>}
      </select></label>
      {image && <a className="volume-mpr-download" href={image} download={`cpr-${path.id}-${rotation}deg.png`}><Download size={14} /> CPR PNG</a>}
    </div>
    </details>
    <p className="caption">Orange marker = selected candidate position. Click the CPR or profile to locate that point in the linked MPR and 3D views.{listing?.can_review ? " Reviewer marker placement also selects minimum/reference positions; save explicitly to record them." : ""}</p>
    {listing?.can_review ? <form className="volume-cpr-review" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="caption">Name the artery only after review. To calculate reviewer diameters and narrowing, select both positions on the image/profile or enter their distances below, then save a new review. Positions must be at least 1 mm apart. Saving a decision alone does not create measurements.</p>
      <fieldset><legend>Reviewer edit for {path.id}</legend>
        <label>Minimum position (mm)<input aria-label="Minimum position (mm)" type="number" min="0" max={path.length_mm} step=".1" value={minimum ?? ''} onChange={event => setMinimum(event.target.value === '' ? null : Number(event.target.value))} /></label>
        <label>Reference position (mm)<input aria-label="Reference position (mm)" type="number" min="0" max={path.length_mm} step=".1" value={reference ?? ''} onChange={event => setReference(event.target.value === '' ? null : Number(event.target.value))} /></label>
        <label>Decision <select value={decision} onChange={event => setDecision(event.target.value)}>
          <option value="accept">Accept as vessel</option><option value="uncertain">Uncertain</option><option value="reject">Reject (not a vessel path)</option></select></label>
        <label>Artery <select value={artery} onChange={event => setArtery(event.target.value)}><option value="">Not named</option>
          {listing.arteries.map(name => <option key={name} value={name}>{label(name)}</option>)}</select></label>
        <span className="volume-cpr-markers">Minimum {minimum == null ? "—" : `${minimum} mm`} · Reference {reference == null ? "—" : `${reference} mm`}
          {(minimum != null || reference != null) && <button type="button" onClick={() => { setMinimum(null); setReference(null); setPlacing("minimum"); }}>Clear markers</button>}</span>
        <label className="volume-cpr-notes">Notes <input value={notes} maxLength={500} onChange={event => setNotes(event.target.value)} /></label>
        <button type="submit" className="volume-cpr-save" disabled={saving || !maskSha256 || (minimum == null) !== (reference == null) || (minimum != null && reference != null && (Math.abs(minimum-reference) < 1 || decision === "reject"))}>{saving ? "Saving…" : "Save review"}</button>
      </fieldset>
      {message && <p role="status" className="caption">{message}</p>}
    </form> : listing && <p className="caption">Reviewer edits can be saved by doctors, clinicians and administrators with review access to this case.</p>}
    {listing && listing.current.length > 0 && <div className="table-scroll"><table className="stenosis-summary"><caption>Reviewer geometry edits · {listing.history.length} recorded, latest per path shown</caption>
      <thead><tr><th>Path</th><th>Decision</th><th>Artery</th><th>Reviewer min / ref</th><th>Narrowing</th><th>Reviewer</th></tr></thead>
      <tbody>{listing.current.map(row => <tr key={row.id}><td>{row.path_id}</td><td>{label(row.decision)}</td><td>{row.artery ? label(row.artery) : "Not named by reviewer"}</td>
        <td>{row.measurement ? `${row.measurement.minimum_diameter_mm.toFixed(2)} / ${row.measurement.reference_diameter_mm.toFixed(2)} mm` : "Not measured · no saved marker pair"}</td>
        <td>{row.measurement ? `${row.measurement.narrowing_percent.toFixed(1)}%` : "Not calculated · no saved measurements"}</td><td>{row.reviewer_role} · {row.reviewed_at.slice(0, 10)}</td></tr>)}</tbody>
    </table></div>}
    <p className="caption">Research view of the predicted mask. Reviewer diameters are computed by the server at the placed markers on the predicted mask, so they are not independent of the model; the model output is unchanged.</p>
  </section>;
}
