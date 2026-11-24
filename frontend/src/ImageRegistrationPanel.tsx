import { useEffect, useState } from "react";
import { apiUrl, request } from "./api";
import { Card } from "./components/prismui/card";
import { describeTransform, summarize, VIEW_LABELS, type RegistrationResult, type RegistrationView } from "./lib/registration";

type FrameOption = { id: string; original_name: string };

/** Fetches an authenticated PNG and exposes it as an object URL for an <img>. */
function useAuthenticatedImage(path: string | null, token: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!path) { setUrl(""); return; }
    let active = true;
    let created = "";
    fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("The overlay could not be loaded."))))
      .then((blob) => { if (active) { created = URL.createObjectURL(blob); setUrl(created); } })
      .catch(() => { if (active) setUrl(""); });
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [path, token]);
  return url;
}

/** Align another frame of the same case to the selected image, for visual comparison only. */
export default function ImageRegistrationPanel({ token, images, imageId }: { token: string; images: FrameOption[]; imageId: string }) {
  const others = images.filter((image) => image.id !== imageId);
  const [referenceId, setReferenceId] = useState(others[0]?.id ?? "");
  const [mode, setMode] = useState<"rigid" | "affine">("rigid");
  const [view, setView] = useState<RegistrationView>("blend");
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!others.some((image) => image.id === referenceId)) setReferenceId(others[0]?.id ?? ""); }, [imageId, images.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!referenceId) { setResult(null); return; }
    let active = true;
    setBusy(true); setError("");
    request<RegistrationResult>(`/api/images/${imageId}/registration?reference_id=${referenceId}&mode=${mode}`, token)
      .then((next) => { if (active) setResult(next); })
      .catch((cause: Error) => { if (active) { setResult(null); setError(cause.message); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [imageId, referenceId, mode, token]);

  const overlay = useAuthenticatedImage(result ? result.overlay_urls[view] : null, token);
  const summary = result ? summarize(result) : null;
  if (others.length === 0) return null;

  return <Card className="panel image-registration">
    <div className="viewer-heading"><div><h3>Align two images of this case</h3><p className="muted">Compare another frame of this case with the selected image after correcting a shift, rotation or small scale change.</p></div></div>
    <div className="registration-controls">
      <label>Reference image<select value={referenceId} onChange={(event) => setReferenceId(event.target.value)}>{others.map((image) => <option key={image.id} value={image.id}>{image.original_name}</option>)}</select></label>
      <label>Alignment<select value={mode} onChange={(event) => setMode(event.target.value as "rigid" | "affine")}><option value="rigid">Rigid (shift and rotation)</option><option value="affine">Affine (adds scale)</option></select></label>
    </div>
    {busy && <p role="status">Aligning…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {result && summary && <>
      <p role="status" className={`registration-summary tone-${summary.tone}`}>{summary.label}</p>
      {result.success && <ul className="registration-parameters">{describeTransform(result).map((line) => <li key={line}>{line}</li>)}</ul>}
      {result.moving_resized_to_reference && <p className="muted">The frames had different sizes, so the selected image was resized to the reference grid first.</p>}
      <div className="registration-views" role="group" aria-label="Overlay view">{(Object.keys(VIEW_LABELS) as RegistrationView[]).map((key) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>{VIEW_LABELS[key]}</button>)}</div>
      {overlay ? <img className="registration-overlay" src={overlay} alt={`Overlay of the selected image aligned to the reference: ${VIEW_LABELS[view]}`} /> : <p className="muted">Loading the overlay…</p>}
      <p className="caption">{result.note} Frames from different projection angles cannot be aligned by a 2D transform.</p>
    </>}
  </Card>;
}
