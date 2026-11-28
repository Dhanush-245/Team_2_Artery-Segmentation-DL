import { readViewerSession, saveViewerSession } from "./lib/viewerSession";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { apiUrl } from "./api";
import VolumeOrbit from "./VolumeOrbit";
import { WINDOW_PRESETS } from "./VolumeMprViewer";
import { PLANES, centerPosition, clampPan, clampPosition, clampZoom, crosshairFraction, positionFromClick, stepAlong, type Plane, type Position } from "./lib/linkedViews";

/** A place to move every view to: world coordinates (mm) from a candidate, or a voxel index. */
export type ViewTarget = { ras?: [number, number, number]; label: string; nonce: number; scroll?: boolean };

type Shared = { caseId: string; runId: string; token: string; shape: number[]; win: number; level: number; opacity: number; heatId?: string; heatOpacity: number; zoom: number; maskVersion: number | null; focusRevision: number; axisCodes: string[]; cardinal: boolean };

function PlanePanel({ plane, position, shared, onPosition }: { plane: Plane; position: Position; shared: Shared; onPosition: (next: Position) => void }) {
  const { caseId, runId, token, shape, win, level, opacity, heatId, heatOpacity, zoom: linkedZoom, maskVersion, focusRevision, axisCodes, cardinal } = shared;
  const [localZoom, setLocalZoom] = useState<{ value: number; linkedZoom: number; focusRevision: number } | null>(null);
  const zoom = localZoom?.linkedZoom === linkedZoom && localZoom.focusRevision === focusRevision ? localZoom.value : linkedZoom;
  const setPanelZoom = (value: number) => setLocalZoom({ value: clampZoom(value), linkedZoom, focusRevision });
  const index = position[plane.axis];
  const depth = Math.max(1, shape[plane.axis] ?? 1);
  const [image, setImage] = useState("");
  const [ratio, setRatio] = useState(1);
  const [imageIndex, setImageIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const panKey = `${caseId}.${runId}.${plane.id}.pan`;
  const [pan, setPan] = useState(() => readViewerSession(panKey, { x: 0, y: 0 }));
  useEffect(() => { saveViewerSession(panKey, pan); }, [panKey, pan]);
  const frame = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const current = useRef("");
  const drag = useRef<{ x: number; y: number; moved: boolean; pan: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ axis: String(plane.axis), index: String(index), window: String(win), level: String(level), opacity: String(opacity / 100) });
    if (maskVersion !== null) query.set("mask_version", String(maskVersion));
    if (heatId) { query.set("xai", heatId); query.set("xai_opacity", String(heatOpacity / 100)); }
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch(apiUrl(`/api/cases/${caseId}/volumes/analyses/${runId}/mpr.png?${query}`), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? "Saved source and mask unavailable." : "Slice could not be rendered.");
        const url = URL.createObjectURL(await response.blob());
        if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = url; setImage(url); setImageIndex(index);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError((cause as Error).message);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 100);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [caseId, runId, token, plane.axis, index, win, level, opacity, heatId, heatOpacity, maskVersion]);
  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);
  useEffect(() => {
    const box = frame.current?.getBoundingClientRect();
    setPan(value => clampPan(value, zoom, box?.width ?? 0, box?.height ?? 0));
  }, [zoom]);

  // Scroll wheel moves through slices; a non-passive listener keeps the page from scrolling while the pointer is over the image.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onPosition(stepAlong(plane, position, shape, event.deltaY > 0 ? 1 : -1));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [plane, position, shape, onPosition]);

  const { fx, fy } = crosshairFraction(plane, position, shape);
  useEffect(() => {
    const box = frame.current;
    if (!box || !focusRevision) return;
    const width = Math.min(box.clientWidth, box.clientHeight * ratio);
    setPan(zoom === 1 ? { x: 0, y: 0 } : {
      x: (.5 - fx) * width * zoom,
      y: (.5 - fy) * (width / ratio) * zoom,
    });
  // Recenter only on explicit focus/reset, not while browsing slices.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRevision, ratio]);
  const opposite: Record<string, string> = { R: 'L', L: 'R', A: 'P', P: 'A', S: 'I', I: 'S' };
  const normal = axisCodes[plane.axis];
  const planeName = !normal ? plane.label : !cardinal ? `Native plane ${plane.axis + 1}` :
    'RL'.includes(normal) ? 'Sagittal' : 'AP'.includes(normal) ? 'Coronal' : 'Axial';
  const finish = (event: React.PointerEvent) => {
    const state = drag.current; drag.current = null;
    if (!state || state.moved || imageIndex !== index || !picture.current) return;
    const box = picture.current.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    onPosition(positionFromClick(plane, position, shape, (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height));
  };
  return <figure className="lv-panel">
    <figcaption><strong>{planeName}{cardinal || !normal ? " MPR" : ""}</strong><span>Slice {index + 1} / {depth}</span></figcaption>
    <div className="lv-panel-zoom" role="group" aria-label={`${planeName} zoom controls`}>
      <button type="button" className="volume-orbit-tool" title="Zoom out" aria-label={`Zoom out ${planeName}`} disabled={zoom <= 1} onClick={() => setPanelZoom(zoom / 1.25)}><ZoomOut size={17} /></button>
      <span aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button type="button" className="volume-orbit-tool" title="Zoom in" aria-label={`Zoom in ${planeName}`} disabled={zoom >= 8} onClick={() => setPanelZoom(zoom * 1.25)}><ZoomIn size={17} /></button>
      <button type="button" className="volume-orbit-tool" title="Fit slice" aria-label={`Fit ${planeName} slice`} onClick={() => { setPanelZoom(1); setPan({x: 0, y: 0}); }}><RotateCcw size={17} /></button>
    </div>
    <div ref={frame} className="lv-frame" tabIndex={0} role="img"
      aria-label={`${planeName} slice ${index + 1} of ${depth}. Click to place the crosshair, scroll or use arrow keys to change slice, drag to pan when zoomed.`}
      onKeyDown={event => {
        const delta = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -1 : 0;
        if (delta) { event.preventDefault(); onPosition(stepAlong(plane, position, shape, delta * (event.shiftKey ? 10 : 1))); }
      }}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, moved: false, pan }; }}
      onPointerMove={event => {
        const state = drag.current; if (!state) return;
        const dx = event.clientX - state.x, dy = event.clientY - state.y;
        if (!state.moved && Math.hypot(dx, dy) < 4) return;
        state.moved = true;
        const box = frame.current?.getBoundingClientRect();
        setPan(clampPan({ x: state.pan.x + dx, y: state.pan.y + dy }, zoom, box?.width ?? 0, box?.height ?? 0));
      }}
      onPointerUp={finish} onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => setPan({ x: 0, y: 0 })}>
      {image && imageIndex === index && <div className="lv-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <div className="lv-image-box" style={{ width: `min(100cqw, ${ratio * 100}cqh)`, aspectRatio: ratio }}>
          <img ref={picture} src={image} alt="" draggable={false} onLoad={event => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
          <i className="lv-line lv-v" style={{ left: `${fx * 100}%` }} /><i className="lv-line lv-h" style={{ top: `${fy * 100}%` }} />
          <i className="lv-dot" style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }} />
        </div>
      </div>}
      {cardinal && axisCodes.length === 3 && <>
        <span className="lv-orientation left">{opposite[axisCodes[plane.col]]}</span>
        <span className="lv-orientation right">{axisCodes[plane.col]}</span>
        <span className="lv-orientation top">{axisCodes[plane.row]}</span>
        <span className="lv-orientation bottom">{opposite[axisCodes[plane.row]]}</span>
      </>}
      {loading && <span className="volume-mpr-busy" role="status"><Loader2 size={14} className="spin" /> Rendering</span>}
      {error && <p role="alert" className="volume-mpr-error">{error}</p>}
    </div>
  </figure>;
}

type Props = { caseId: string; runId: string; token: string; shape: number[]; heatId?: string; heatLabel?: string;
  previewUrl?: string | null; target?: ViewTarget | null; maskVersion?: number | null; onCrosshair?: (position: Position) => void; children?: ReactNode; selectedPath?: number[][]; candidatePanel?: ReactNode };

/** Four linked panels (axial, coronal, sagittal, 3D surface) sharing one crosshair, window/level and overlay settings. */
export default function VolumeLinkedViewer({ caseId, runId, token, shape, heatId, heatLabel, previewUrl, target, maskVersion = null, onCrosshair, children, selectedPath, candidatePanel }: Props) {
  const sessionKey = `${caseId}.${runId}.viewport`;
  const [saved] = useState(() => readViewerSession<null | { position: Position; win: number; level: number; opacity: number; zoom: number }>(sessionKey, null));
  const [surfaceTarget, setSurfaceTarget] = useState<ViewTarget | null>(null);
  const activeTarget = surfaceTarget && surfaceTarget.nonce > (target?.nonce ?? 0) ? surfaceTarget : target;
  const [focusRevision, setFocusRevision] = useState(0);
  const [orientation, setOrientation] = useState<{ axisCodes: string[]; cardinal: boolean }>({axisCodes: [], cardinal: false});
  const [showMask, setShowMask] = useState(() => readViewerSession(sessionKey + '.mask', true));
  const [mode, setMode] = useState<"four" | "single">("four");
  const [position, setPositionState] = useState<Position>(() => saved ? clampPosition(saved.position, shape) : centerPosition(shape));
  const [win, setWin] = useState(saved?.win ?? 800);
  const [level, setLevel] = useState(saved?.level ?? 300);
  const [opacity, setOpacity] = useState(saved?.opacity ?? 55);
  const [heatOpacity, setHeatOpacity] = useState(70);
  const [zoom, setZoom] = useState(saved?.zoom ?? 1);
  const [ras, setRas] = useState<[number, number, number] | null>(null);
  const [note, setNote] = useState("");
  const [full, setFull] = useState(false);
  const root = useRef<HTMLElement>(null);
  const setPosition = useCallback((next: Position) => setPositionState(clampPosition(next, shape)), [shape]);

  const inspectSlice = useCallback((next: Position) => { setPosition(next); setNote("Inspecting linked CTA slices"); }, [setPosition]);

  useEffect(() => { saveViewerSession(sessionKey, { position, win, level, opacity, zoom }); }, [sessionKey, position, win, level, opacity, zoom]);
  useEffect(() => { saveViewerSession(sessionKey + '.mask', showMask); }, [sessionKey, showMask]);
  useEffect(() => { onCrosshair?.(position); }, [onCrosshair, position]);

  // World coordinates of the crosshair (also drives the 3D marker); one lookup after the crosshair settles.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(apiUrl(`/api/cases/${caseId}/volumes/analyses/${runId}/locate?i=${position[0]}&j=${position[1]}&k=${position[2]}`), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        .then(response => response.ok ? response.json() : null)
        .then(body => { if (body && !controller.signal.aborted) { setRas(body.ras_mm); setOrientation({axisCodes: body.axis_codes ?? [], cardinal: body.cardinal_axes === true}); } })
        .catch(() => undefined);
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [caseId, runId, token, position]);

  // A candidate or path chosen elsewhere on the page moves every view to its location.
  useEffect(() => {
    if (!activeTarget?.ras) return;
    const controller = new AbortController();
    const [x, y, z] = activeTarget.ras;
    fetch(apiUrl(`/api/cases/${caseId}/volumes/analyses/${runId}/locate?x=${x}&y=${y}&z=${z}`), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("locate failed")))
      .then(body => {
        if (controller.signal.aborted) return;
        setMode("four"); setZoom(2); setPosition(body.ijk as Position); setFocusRevision(v => v + 1);
        setNote(body.inside_volume ? `Showing ${activeTarget.label}` : `${activeTarget.label} lies outside the saved volume; showing the nearest edge`);
        if (activeTarget.scroll !== false) root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch(() => { if (!controller.signal.aborted) setNote(`Could not locate ${activeTarget.label}`); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTarget?.nonce]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen?.(); };
  const preset = WINDOW_PRESETS.find(p => p.window === win && p.level === level)?.id ?? "custom";
  const shared: Shared = { caseId, runId, token, shape, win, level, opacity: showMask ? opacity : 0, heatId: showMask ? heatId : undefined, heatOpacity, zoom, maskVersion, focusRevision, ...orientation };

  return <section ref={root} id="v3d-viewer" className={`lv-viewer${full ? " lv-full" : ""}`} aria-labelledby="lv-title">
    <div className="volume-mpr-heading">
      <div><span className="eyebrow">3D &amp; MPR VIEWER</span><h4 id="lv-title">Linked views of the source volume and predicted mask</h4></div>
      <div className="volume-mpr-axes" role="tablist" aria-label="Viewer layout">
        <button type="button" role="tab" aria-selected={mode === "four"} className={mode === "four" ? "active" : ""} onClick={() => setMode("four")}>Four panels</button>
        <button type="button" role="tab" aria-selected={mode === "single"} className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>Single plane</button>
      </div>
    </div>
    {mode === "four" ? <>
      <div className="lv-toolbar" role="group" aria-label="Viewer controls">
        <label>Preset
          <select value={preset} onChange={event => { const p = WINDOW_PRESETS.find(item => item.id === event.target.value); if (p) { setWin(p.window); setLevel(p.level); } }}>
            {WINDOW_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label} ({p.window}/{p.level})</option>)}
            {preset === "custom" && <option value="custom">Custom ({win}/{level})</option>}
          </select>
        </label>
        <label>W<input type="number" min={1} max={5000} value={win} onChange={event => setWin(Math.max(1, Number(event.target.value) || 1))} /></label>
        <label>L<input type="number" min={-1500} max={3000} value={level} onChange={event => setLevel(Number(event.target.value) || 0)} /></label>
        <button type="button" className="lv-goto" aria-pressed={showMask} onClick={() => setShowMask(v => !v)}>{showMask ? "Show original CTA" : "Show segmentation"}</button>
        <label className="volume-mpr-opacity"><span>Segmentation opacity {opacity}%</span><input type="range" min={0} max={100} value={opacity} onChange={event => setOpacity(Number(event.target.value))} aria-label="Mask overlay opacity" /></label>
        {heatId && <label className="volume-mpr-opacity"><span>{heatLabel ?? "Attribution"} {heatOpacity}%</span><input type="range" min={0} max={100} value={heatOpacity} onChange={event => setHeatOpacity(Number(event.target.value))} aria-label="Attribution overlay opacity" /></label>}
        <span className="volume-orbit-divider" aria-hidden="true" />
        <button type="button" className="volume-orbit-tool" aria-label="Zoom out all MPR panels" disabled={zoom <= 1} onClick={() => setZoom(value => clampZoom(value / 1.25))}><ZoomOut size={16} /></button>
        <span className="volume-orbit-zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="volume-orbit-tool" aria-label="Zoom in all MPR panels" disabled={zoom >= 8} onClick={() => setZoom(value => clampZoom(value * 1.25))}><ZoomIn size={16} /></button>
        <button type="button" className="volume-orbit-tool" aria-label="Reset zoom and crosshair" onClick={() => { setZoom(1); setPosition(centerPosition(shape)); setFocusRevision(v => v + 1); setNote(""); }}><RotateCcw size={16} /></button>
        <button type="button" className="volume-orbit-tool" aria-label={full ? "Exit full screen" : "Full screen"} aria-pressed={full} onClick={toggleFull}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      </div>
      <div className="lv-readout" role="status" aria-live="polite">
        <details><summary>Technical position</summary><span>Voxel {position[0]}, {position[1]}, {position[2]}</span>
        <span>{ras ? `World ${ras.map(v => v.toFixed(1)).join(", ")} mm (RAS)` : "World coordinates loading"}</span>
        </details>
        {maskVersion !== null && <span className="lv-note">Mask: reviewer version {maskVersion}</span>}
        {note && <span className="lv-note">{note}</span>}
      </div>
      <div className="lv-grid">
        {[PLANES[0], PLANES[2], PLANES[1]].map(plane => <PlanePanel key={plane.id} plane={plane} position={position} shared={shared} onPosition={inspectSlice} />)}
        <figure className="lv-panel lv-orbit">
          <figcaption><strong>3D Vessel View</strong><span>{ras && previewUrl ? "yellow: crosshair · orange: selected path" : "predicted vessel mask"}</span></figcaption>
          {previewUrl ? <VolumeOrbit url={previewUrl} token={token} marker={ras} onPick={ras => setSurfaceTarget({ras, label: "selected surface point", nonce: Date.now(), scroll: false})} selectedPath={selectedPath} compact /> : <p className="muted lv-empty">No saved 3D surface is available for this run. Use the linked slice panels to inspect the source.</p>}
        </figure>
      </div>
      {candidatePanel}
      <p className="caption">Click a slice to place the shared crosshair; the other two planes and the 3D marker follow. Scroll or use the arrow keys (Shift for steps of 10) to change slice, drag to pan when zoomed, double-click a panel to recentre it. Rendered on demand from the saved full-resolution source and predicted mask; the mask is a research prediction that needs review.</p>
    </> : <>{children}</>}
  </section>;
}
