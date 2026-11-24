import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { apiUrl } from './api';

type Point = [number, number, number];
type MaskComponent = { id: number; foreground_voxels: number; points: Point[] };
type SurfaceMesh = { vertices: Point[]; faces: [number, number, number][]; face_components?: number[]; step_voxels?: number | null };
type Preview = { world_centre_mm?: Point; world_radius_mm?: number; foreground_voxels: number; component_count: number; mesh?: SurfaceMesh; components: MaskComponent[]; points: Point[] };
type View = { yaw: number; pitch: number; zoom: number };

const INITIAL: View = { yaw: 0.55, pitch: 0.35, zoom: 1 };
const TURN = Math.PI / 12;
const PITCH_LIMIT = Math.PI / 2 - 0.001;
/** World coordinates are RAS (x right, y anterior, z superior); positive pitch looks down from above. */
const PRESETS: { label: string; yaw: number; pitch: number }[] = [
  { label: 'Angled', yaw: INITIAL.yaw, pitch: INITIAL.pitch },
  { label: 'Anterior', yaw: 0, pitch: 0 },
  { label: 'Lateral', yaw: Math.PI / 2, pitch: 0 },
  { label: 'Superior', yaw: 0, pitch: PITCH_LIMIT },
];

function normalize(v: number[]): Point { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }
const LIGHT = normalize([0.35, 0.6, 0.75]);

/** World point → camera space: [screen x, screen y, depth toward the viewer]. */
function camera([x, y, z]: Point, view: View): Point {
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const horizontal = cy * x + sy * y;
  const toward = -sy * x + cy * y;
  return [horizontal, cp * z - sp * toward, sp * z + cp * toward];
}

export default function VolumeOrbit({ url, token, marker = null, compact = false }: { url: string; token: string; marker?: Point | null; compact?: boolean }) {
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>(INITIAL);
  const [grid, setGrid] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    // One tick of delay lets React StrictMode cancel its probe effect before it uses the server's single preview slot.
    const timer = window.setTimeout(() => {
      fetch(apiUrl(url), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        .then(async response => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.detail || 'Unable to load the saved 3D mask.');
          return body as Preview;
        })
        .then(result => { if (!controller.signal.aborted) setData(result); })
        .catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [url, token, attempt]);

  /** The crosshair in the preview's normalised frame: (world - centre) / radius, using values the server saved with the mesh. */
  const markerPoint = useMemo<Point | null>(() => {
    if (!marker || !data?.world_centre_mm || !data.world_radius_mm) return null;
    const [cx, cy, cz] = data.world_centre_mm, radius = data.world_radius_mm;
    return [(marker[0] - cx) / radius, (marker[1] - cy) / radius, (marker[2] - cz) / radius];
  }, [marker, data]);

  /** Visible geometry, re-centred and scaled to fill the view, plus the floor height for the grid. */
  const scene = useMemo(() => {
    if (!data) return null;
    const mesh = data.mesh;
    const hasMesh = !!mesh?.faces.length;
    const tags = mesh?.face_components ?? [];
    const faces = hasMesh ? mesh!.faces.map((face, index) => ({ face, component: tags[index] ?? 1 })).filter(item => showAll || item.component === 1) : [];
    const points = hasMesh ? [] : (showAll ? data.components.flatMap(c => c.points) : data.components[0]?.points ?? data.points);
    const used = hasMesh ? faces.flatMap(item => item.face.map(index => mesh!.vertices[index])) : points;
    if (!used.length) return null;
    const min = [0, 1, 2].map(axis => used.reduce((m, p) => Math.min(m, p[axis]), Infinity));
    const max = [0, 1, 2].map(axis => used.reduce((m, p) => Math.max(m, p[axis]), -Infinity));
    const centre = min.map((value, axis) => (value + max[axis]) / 2);
    const half = Math.max(...max.map((value, axis) => (value - min[axis]) / 2)) || 1;
    const fit = (p: Point): Point => [(p[0] - centre[0]) / half, (p[1] - centre[1]) / half, (p[2] - centre[2]) / half];
    return { hasMesh, faces, vertices: hasMesh ? mesh!.vertices.map(fit) : [], points: points.map(fit), fit,
      floor: (min[2] - centre[2]) / half - 0.08 };
  }, [data, showAll]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context || !scene) return;
    const draw = () => {
      const { width, height } = element.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const scale = Math.min(width, height) * 0.38 * view.zoom;
      const screen = (p: Point) => [width / 2 + p[0] * scale, height / 2 - p[1] * scale] as const;
      const line = (a: Point, b: Point, color: string) => {
        context.beginPath(); context.moveTo(...screen(camera(a, view))); context.lineTo(...screen(camera(b, view)));
        context.strokeStyle = color; context.lineWidth = 1; context.stroke();
      };
      if (grid) for (let i = -5; i <= 5; i++) {
        const o = (i / 5) * 1.15;
        line([o, -1.15, scene.floor], [o, 1.15, scene.floor], 'rgba(96,165,250,.22)');
        line([-1.15, o, scene.floor], [1.15, o, scene.floor], 'rgba(96,165,250,.22)');
      }
      if (scene.hasMesh) {
        const cam = scene.vertices.map(v => camera(v, view));
        const light = camera(LIGHT, view);
        const ordered = scene.faces.map(item => ({ ...item, depth: (cam[item.face[0]][2] + cam[item.face[1]][2] + cam[item.face[2]][2]) / 3 }))
          .sort((a, b) => a.depth - b.depth);
        for (const { face, component } of ordered) {
          const [a, b, c] = face.map(index => cam[index]);
          const normal = normalize([(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
            (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]);
          const shade = 0.3 + 0.7 * Math.abs(normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
          const [hue, saturation] = component === 1 ? [188, 72] : [32, 85];
          const [p0, p1, p2] = [a, b, c].map(screen);
          context.beginPath(); context.moveTo(...p0); context.lineTo(...p1); context.lineTo(...p2); context.closePath();
          context.fillStyle = `hsl(${hue} ${saturation}% ${Math.round(20 + shade * 48)}%)`;
          context.fill(); context.strokeStyle = context.fillStyle; context.lineWidth = 0.5; context.stroke();
        }
      } else {
        const projected = scene.points.map(p => camera(p, view)).sort((a, b) => a[2] - b[2]);
        for (const p of projected) {
          const [x, y] = screen(p);
          context.fillStyle = `hsl(188 76% ${Math.round(45 + p[2] * 18)}%)`;
          context.beginPath(); context.arc(x, y, 1.6, 0, Math.PI * 2); context.fill();
        }
      }
      if (markerPoint) {
        const [mx, my] = screen(camera(scene.fit(markerPoint), view));
        context.beginPath(); context.arc(mx, my, 6, 0, Math.PI * 2); context.strokeStyle = '#fde047'; context.lineWidth = 2; context.stroke();
        context.beginPath(); context.arc(mx, my, 2, 0, Math.PI * 2); context.fillStyle = '#fde047'; context.fill();
      }
      // Orientation marker: R (right), A (anterior), S (superior).
      const origin: [number, number] = [34, height - 34];
      for (const [label, axis, color] of [['R', [1, 0, 0], '#f87171'], ['A', [0, 1, 0], '#4ade80'], ['S', [0, 0, 1], '#60a5fa']] as const) {
        const p = camera(axis as unknown as Point, view);
        context.beginPath(); context.moveTo(...origin); context.lineTo(origin[0] + p[0] * 20, origin[1] - p[1] * 20);
        context.strokeStyle = color; context.lineWidth = 2; context.stroke();
        context.fillStyle = color; context.font = '600 11px system-ui, sans-serif';
        context.fillText(label, origin[0] + p[0] * 27 - 3, origin[1] - p[1] * 27 + 4);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scene, view, grid, markerPoint]);

  // Wheel zoom needs a non-passive listener so the page does not scroll while zooming.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    // Plain scrolling keeps scrolling the page; zoom only on a trackpad pinch or Ctrl/⌘ + scroll.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setView(v => ({ ...v, zoom: Math.max(0.5, Math.min(4, v.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))) }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [scene]);

  const rotate = (yaw: number, pitch: number) => setView(v => ({ ...v, yaw: (v.yaw + yaw) % (2 * Math.PI), pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, v.pitch + pitch)) }));
  const zoomBy = (factor: number) => setView(v => ({ ...v, zoom: Math.max(0.5, Math.min(4, v.zoom * factor)) }));

  if (error) return <div className="volume-orbit"><p role="alert">{error}</p><button type="button" className="volume-orbit-tool wide" onClick={() => setAttempt(a => a + 1)}>Retry</button></div>;
  if (!data) return <div className="volume-orbit"><p role="status" className="volume-orbit-loading"><Loader2 size={16} className="spin" /> Building the vessel surface…</p></div>;
  if (!scene) return <div className="volume-orbit"><p role="status">The saved mask is empty. Use the slice viewer to review the run.</p></div>;
  const others = Math.max(0, data.component_count - 1);
  const presetActive = (p: { yaw: number; pitch: number }) => Math.abs(view.yaw - p.yaw) < 1e-3 && Math.abs(view.pitch - p.pitch) < 1e-3;

  return <section className={`volume-orbit${compact ? ' compact' : ''}`} aria-labelledby="volume-orbit-title">
    <div className="volume-orbit-heading">
      <div><span className="eyebrow">3D SURFACE</span><h4 id="volume-orbit-title">Predicted vessel mask</h4></div>
      <div className="volume-orbit-presets" role="group" aria-label="View direction">
        {PRESETS.map(preset => <button key={preset.label} type="button" aria-pressed={presetActive(preset)} className={presetActive(preset) ? 'active' : ''}
          onClick={() => setView(v => ({ ...v, yaw: preset.yaw, pitch: preset.pitch }))}>{preset.label}</button>)}
      </div>
    </div>
    <canvas ref={canvas} className="volume-orbit-canvas" tabIndex={0}
      aria-label="3D vessel surface. Drag or use the arrow keys to rotate; pinch, Ctrl or Command plus scroll, or plus and minus to zoom; double-click to reset."
      onDoubleClick={() => setView(INITIAL)}
      onKeyDown={event => {
        const keys: Record<string, () => void> = { ArrowLeft: () => rotate(-TURN, 0), ArrowRight: () => rotate(TURN, 0), ArrowUp: () => rotate(0, TURN), ArrowDown: () => rotate(0, -TURN), '+': () => zoomBy(1.2), '=': () => zoomBy(1.2), '-': () => zoomBy(1 / 1.2) };
        if (keys[event.key]) { event.preventDefault(); keys[event.key](); }
      }}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }}
      onPointerMove={event => {
        const last = pointer.current; if (!last || last.id !== event.pointerId) return;
        rotate((event.clientX - last.x) * 0.01, (event.clientY - last.y) * 0.01);
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onLostPointerCapture={() => { pointer.current = null; }} />
    <div className="volume-orbit-toolbar" role="group" aria-label="3D view controls">
      <button type="button" className="volume-orbit-tool" aria-label="Rotate left" title="Rotate left" onClick={() => rotate(-TURN, 0)}><ArrowLeft size={16} /></button>
      <button type="button" className="volume-orbit-tool" aria-label="Rotate right" title="Rotate right" onClick={() => rotate(TURN, 0)}><ArrowRight size={16} /></button>
      <button type="button" className="volume-orbit-tool" aria-label="Tilt up" title="Tilt up" onClick={() => rotate(0, TURN)}><ArrowUp size={16} /></button>
      <button type="button" className="volume-orbit-tool" aria-label="Tilt down" title="Tilt down" onClick={() => rotate(0, -TURN)}><ArrowDown size={16} /></button>
      <span className="volume-orbit-divider" aria-hidden="true" />
      <button type="button" className="volume-orbit-tool" aria-label="Zoom out" title="Zoom out" disabled={view.zoom <= 0.5} onClick={() => zoomBy(1 / 1.2)}><ZoomOut size={16} /></button>
      <span className="volume-orbit-zoom" aria-live="polite">{Math.round(view.zoom * 100)}%</span>
      <button type="button" className="volume-orbit-tool" aria-label="Zoom in" title="Zoom in" disabled={view.zoom >= 4} onClick={() => zoomBy(1.2)}><ZoomIn size={16} /></button>
      <button type="button" className="volume-orbit-tool" aria-label="Reset view" title="Reset view" onClick={() => setView(INITIAL)}><RotateCcw size={16} /></button>
      <span className="volume-orbit-divider" aria-hidden="true" />
      <label className="volume-orbit-toggle"><input type="checkbox" checked={grid} onChange={event => setGrid(event.target.checked)} />Floor grid</label>
      {others > 0 && <label className="volume-orbit-toggle"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />Show {others} disconnected fragment{others === 1 ? '' : 's'}</label>}
    </div>
    <div className="volume-orbit-legend">
      <span><i className="swatch main" />Largest connected component</span>
      {showAll && others > 0 && <span><i className="swatch other" />Disconnected fragments</span>}
      <span className="muted">{data.foreground_voxels.toLocaleString()} mask voxels{data.mesh?.step_voxels && data.mesh.step_voxels > 1 ? ` · surface simplified ${data.mesh.step_voxels}×` : ''}</span>
    </div>
    <p className="caption volume-orbit-hint">Drag to rotate · pinch or Ctrl/⌘ + scroll to zoom · double-click to reset</p>
    {others > 0 && <p className="volume-orbit-note" role="note">The prediction has {data.component_count} disconnected pieces. Measurements use one connected component only; fragments often indicate segmentation errors and need review.</p>}
  </section>;
}
