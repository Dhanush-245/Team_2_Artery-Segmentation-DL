import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { apiUrl } from "./api";

/** Window/level presets in Hounsfield units (width, centre). */
export const WINDOW_PRESETS = [
  { id: "cta", label: "Coronary CTA", window: 800, level: 300 },
  { id: "soft", label: "Soft tissue", window: 400, level: 40 },
  { id: "lung", label: "Lung", window: 1500, level: -600 },
  { id: "bone", label: "Bone", window: 2000, level: 500 },
] as const;
/** Saved source arrays keep their stored orientation, so axis names are the usual convention, not a guarantee. */
const AXES = [
  { axis: 2, label: "Axial", hint: "array axis 3" },
  { axis: 1, label: "Coronal", hint: "array axis 2" },
  { axis: 0, label: "Sagittal", hint: "array axis 1" },
] as const;

type Props = { caseId: string; runId: string; token: string; shape: number[]; heatId?: string; heatLabel?: string };

/** Full-resolution multiplanar slices rendered on demand by the server from the saved source and mask. */
export default function VolumeMprViewer({ caseId, runId, token, shape, heatId, heatLabel }: Props) {
  const [axis, setAxis] = useState<0 | 1 | 2>(2);
  const depth = Math.max(1, shape[axis] ?? 1);
  const [indexByAxis, setIndexByAxis] = useState<Record<number, number>>(() => ({ 0: Math.floor((shape[0] ?? 1) / 2), 1: Math.floor((shape[1] ?? 1) / 2), 2: Math.floor((shape[2] ?? 1) / 2) }));
  const index = Math.min(depth - 1, indexByAxis[axis] ?? 0);
  const [win, setWin] = useState(800);
  const [level, setLevel] = useState(300);
  const [opacity, setOpacity] = useState(55);
  const [heatOpacity, setHeatOpacity] = useState(70);
  const [image, setImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const current = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ axis: String(axis), index: String(index), window: String(win), level: String(level), opacity: String(opacity / 100) });
    if (heatId) { query.set('xai', heatId); query.set('xai_opacity', String(heatOpacity / 100)); }
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch(apiUrl(`/api/cases/${caseId}/volumes/analyses/${runId}/mpr.png?${query}`), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? "The saved source volume and mask are not available for slice viewing." : "This slice could not be rendered.");
        const url = URL.createObjectURL(await response.blob());
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = url; setImage(url);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError((cause as Error).message);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [caseId, runId, token, axis, index, win, level, opacity, heatId, heatOpacity]);
  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);

  const step = (delta: number) => setIndexByAxis(prev => ({ ...prev, [axis]: Math.max(0, Math.min(depth - 1, index + delta)) }));
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); step(event.shiftKey ? -10 : -1); }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); step(event.shiftKey ? 10 : 1); }
  };
  const preset = WINDOW_PRESETS.find(p => p.window === win && p.level === level)?.id ?? "custom";

  return (
    <section className="volume-mpr" aria-labelledby="volume-mpr-title">
      <div className="volume-mpr-heading">
        <div><span className="eyebrow">MULTIPLANAR SLICES</span><h4 id="volume-mpr-title">Source volume with predicted vessel mask</h4></div>
        <div className="volume-mpr-axes" role="tablist" aria-label="Slice direction">
          {AXES.map(item => <button key={item.axis} type="button" role="tab" aria-selected={axis === item.axis} className={axis === item.axis ? "active" : ""} title={item.hint} onClick={() => setAxis(item.axis)}>{item.label}</button>)}
        </div>
      </div>
      <div className="volume-mpr-stage" tabIndex={0} onKeyDown={onKey} aria-label={`${AXES.find(a => a.axis === axis)?.label} slice ${index + 1} of ${depth}. Use arrow keys to move through slices; hold Shift for steps of 10.`}>
        {image && <img src={image} alt={`${AXES.find(a => a.axis === axis)?.label} slice ${index + 1} of ${depth} with the predicted vessel mask in cyan`} />}
        {loading && <span className="volume-mpr-busy" role="status"><Loader2 size={16} className="spin" /> Rendering</span>}
        {error && <p role="alert" className="volume-mpr-error">{error}</p>}
      </div>
      <div className="volume-mpr-controls">
        <div className="volume-mpr-slice">
          <button type="button" aria-label="Previous slice" onClick={() => step(-1)} disabled={index <= 0}><ChevronLeft size={16} /></button>
          <input type="range" min={0} max={depth - 1} value={index} onChange={event => setIndexByAxis(prev => ({ ...prev, [axis]: Number(event.target.value) }))} aria-label="Slice position" />
          <button type="button" aria-label="Next slice" onClick={() => step(1)} disabled={index >= depth - 1}><ChevronRight size={16} /></button>
          <span className="volume-mpr-count" aria-live="polite">{index + 1} / {depth}</span>
        </div>
        <label>Preset
          <select value={preset} onChange={event => { const p = WINDOW_PRESETS.find(item => item.id === event.target.value); if (p) { setWin(p.window); setLevel(p.level); } }}>
            {WINDOW_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label} ({p.window}/{p.level})</option>)}
            {preset === "custom" && <option value="custom">Custom ({win}/{level})</option>}
          </select>
        </label>
        <label>Window (W)<input type="number" min={1} max={5000} value={win} onChange={event => setWin(Math.max(1, Number(event.target.value) || 1))} /></label>
        <label>Level (L)<input type="number" min={-1500} max={3000} value={level} onChange={event => setLevel(Number(event.target.value) || 0)} /></label>
        {heatId && <label className="volume-mpr-opacity"><span>{heatLabel ?? 'Attribution'} · {heatOpacity}%</span><input type="range" min={0} max={100} value={heatOpacity} onChange={event => setHeatOpacity(Number(event.target.value))} aria-label="Attribution overlay opacity" /></label>}
        <label className="volume-mpr-opacity"><span>Mask overlay · {opacity}%</span><input type="range" min={0} max={100} value={opacity} onChange={event => setOpacity(Number(event.target.value))} aria-label="Mask overlay opacity" /></label>
        {image && <a className="volume-mpr-download" href={image} download={`slice-${AXES.find(a => a.axis === axis)?.label.toLowerCase()}-${index + 1}.png`}><Download size={14} /> Slice PNG</a>}
      </div>
      <p className="caption">Rendered on demand from the saved full-resolution source and its predicted mask. Window/level assumes Hounsfield units; the mask is a research prediction that needs review.</p>
    </section>
  );
}
