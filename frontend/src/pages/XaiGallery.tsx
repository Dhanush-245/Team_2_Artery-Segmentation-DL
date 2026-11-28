import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { apiUrl } from "../api";

export type GalleryRow = { case_id: string; case_code: string; run_id: string; record_id: string; task: string; target_id: string;
  method_label: string; status: string; deletion: string; insertion: string; randomization: string;
  energy_inside_target_mask?: number | null; deletion_auc_advantage?: number | null; insertion_auc_advantage?: number | null };
export type Artifact = "overlay" | "heatmap" | "map";
export const ARTIFACT_LABEL: Record<Artifact, string> = { overlay: "Overlay on the image", heatmap: "Heatmap only", map: "Raw attribution map" };

const DOT: Record<string, string> = { PASS: "ok", FAIL: "bad", NOT_TESTED: "muted", NOT_EVALUABLE: "warn" };

/** One saved explanation image, fetched with the user's token because the artifact route is access-controlled. */
function Thumb({ row, kind, token }: { row: GalleryRow; kind: Artifact; token: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true, objectUrl = "";
    setUrl(""); setFailed(false);
    fetch(apiUrl(`/api/cases/${row.case_id}/xai/${row.run_id}/explanations/${row.record_id}/${kind}.png`), { headers: { Authorization: `Bearer ${token}` } })
      .then(response => { if (!response.ok) throw new Error("unavailable"); return response.blob(); })
      .then(blob => { objectUrl = URL.createObjectURL(blob); if (active) setUrl(objectUrl); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [row.case_id, row.run_id, row.record_id, kind, token]);
  if (failed) return <div className="xai-thumb xai-thumb-empty"><ImageOff size={22} aria-hidden="true" /><span>Preview unavailable</span></div>;
  return <div className="xai-thumb">{url ? <img src={url} alt={`${row.method_label} ${kind} for ${row.case_code}`} loading="lazy" /> : <span className="xai-thumb-loading" aria-hidden="true" />}</div>;
}

export default function XaiGallery({ rows, token, onOpen }: { rows: GalleryRow[]; token: string; onOpen: (row: GalleryRow) => void }) {
  const [kind, setKind] = useState<Artifact>("overlay");
  const ready = rows.filter(row => row.status === "ready").slice(0, 12);
  return <>
    <div className="xai-segment" role="group" aria-label="Image shown in the gallery">
      {(Object.keys(ARTIFACT_LABEL) as Artifact[]).map(key => <button key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key)}>{ARTIFACT_LABEL[key]}</button>)}
    </div>
    {ready.length === 0 ? <p className="muted">No ready explanation images yet. Generate one from a case&apos;s Explainable AI step.</p> : <div className="xai-gallery">
      {ready.map(row => <article key={row.record_id} className="xai-card">
        <button type="button" className="xai-card-image" onClick={() => onOpen(row)} aria-label={`Open ${row.case_code} ${row.method_label} in its case`}>
          <Thumb row={row} kind={kind} token={token} /><span className="xai-method-badge">{row.method_label}</span></button>
        <div className="xai-card-body">
          <div className="xai-card-title"><strong>{row.case_code}</strong><small>{row.task === "segmentation" ? "Vessel mask" : row.target_id}</small></div>
          <div className="xai-dots" aria-label={`Deletion ${row.deletion}, insertion ${row.insertion}, randomization ${row.randomization}`}>
            {([["Deletion", row.deletion], ["Insertion", row.insertion], ["Randomization", row.randomization]] as const).map(([name, value]) =>
              <span key={name} className={`xai-dot ${DOT[value] ?? "muted"}`} title={`${name}: ${value.replaceAll("_", " ")}`}><i />{name.slice(0, 3)}</span>)}
          </div>
          {typeof row.energy_inside_target_mask === "number" && <div className="xai-meter" title="Share of the heatmap's energy that falls inside the explained target">
            <span>Inside target</span><div><i style={{ width: `${Math.max(0, Math.min(1, row.energy_inside_target_mask)) * 100}%` }} /></div><b>{(row.energy_inside_target_mask * 100).toFixed(0)}%</b></div>}
        </div>
      </article>)}
    </div>}
  </>;
}
