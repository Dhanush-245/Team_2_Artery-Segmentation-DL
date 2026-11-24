import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "./api";
import { Button } from "./components/prismui/button";

type Component = { rank: number; voxels: number; centroid_ijk: number[]; centroid_ras_mm: number[] };
type Edit = { ijk: [number, number, number]; foreground: boolean };
type Version = { version: number; removed_components: number[]; voxel_edits?: Edit[]; added_voxels?: number; removed_voxels: number; remaining_voxels: number; note: string; reviewer_role: string; created_at: string; edited_mask_sha256: string };
type Listing = { original_mask_sha256: string; components: Component[]; versions: Version[]; current_version: number | null; can_review: boolean };

type Props = { caseId: string; runId: string; token: string; activeVersion: number | null; crosshair: Edit["ijk"] | null;
  onUseVersion: (version: number | null) => void; onLocate: (ras: number[], label: string) => void };

/** Segmentation review: exclude predicted components as a new saved version. The model mask is never overwritten. */
export default function VolumeMaskReviewPanel({ caseId, runId, token, activeVersion, crosshair, onUseVersion, onLocate }: Props) {
  const base = `/api/cases/${caseId}/volumes/analyses/${runId}/mask-review`;
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [edits, setEdits] = useState<Edit[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(() => {
    fetch(apiUrl(base), { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { if (!response.ok) throw new Error("Segmentation review is unavailable for this run."); return response.json() as Promise<Listing>; })
      .then(body => { setData(body); setError(""); })
      .catch(cause => setError((cause as Error).message));
  }, [base, token]);
  useEffect(load, [load]);

  const paint = (foreground: boolean) => {
    if (!crosshair) return;
    setEdits(previous => [...previous.filter(edit => edit.ijk.join() !== crosshair.join()), { ijk: crosshair, foreground }]);
  };
  const save = async () => {
    if (!data || (!chosen.length && !edits.length)) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(apiUrl(base), { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ remove_components: chosen, voxel_edits: edits, note, original_mask_sha256: data.original_mask_sha256 }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "The correction could not be saved.");
      setChosen([]); setEdits([]); setNote(""); onUseVersion(body.version); load();
    } catch (cause) { setError((cause as Error).message); } finally { setSaving(false); }
  };
  const download = async (version: number) => {
    const response = await fetch(apiUrl(`${base}/versions/${version}/mask.nii.gz`), { headers });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = `reviewed-mask-v${version}.nii.gz`; link.click(); URL.revokeObjectURL(url);
  };

  return <section id="v3d-segmentation" className="v3d-block" aria-label="Segmentation review">
    <p className="eyebrow">SEGMENTATION</p><h4>Predicted components and reviewer corrections</h4>
    {error && <p role="alert" className="message error">{error}</p>}
    {!data ? <p role="status">Loading components…</p> : <>
      <div className="table-scroll"><table className="stenosis-summary">
        <thead><tr><th>Component</th><th>Voxels</th><th>Centre (RAS mm)</th><th>Views</th>{data.can_review && <th>Exclude</th>}</tr></thead>
        <tbody>{data.components.map(item => <tr key={item.rank}>
          <td>{item.rank === 1 ? "1 (largest)" : item.rank}</td><td>{item.voxels.toLocaleString()}</td><td>{item.centroid_ras_mm.join(", ")}</td>
          <td><button type="button" className="lv-goto" onClick={() => onLocate(item.centroid_ras_mm, `component ${item.rank}`)}>Show in views</button></td>
          {data.can_review && <td><input type="checkbox" aria-label={`Exclude component ${item.rank}`} checked={chosen.includes(item.rank)}
            onChange={event => setChosen(prev => event.target.checked ? [...prev, item.rank] : prev.filter(rank => rank !== item.rank))} /></td>}
        </tr>)}</tbody>
      </table></div>
      {data.can_review ? <div className="v3d-review-form">
        <p className="caption">Click a slice to position the crosshair, then paint or erase that source-grid voxel. Queued edits apply to the original model mask when you save.</p>
        <div className="cv-actions">
          <Button type="button" variant="outline" size="sm" disabled={!crosshair || edits.length >= 512 || saving} onClick={() => paint(true)}>Paint crosshair voxel</Button>
          <Button type="button" variant="outline" size="sm" disabled={!crosshair || edits.length >= 512 || saving} onClick={() => paint(false)}>Erase crosshair voxel</Button>
          <Button type="button" variant="outline" size="sm" disabled={!edits.length || saving} onClick={() => setEdits(previous => previous.slice(0, -1))}>Undo last voxel</Button>
          <span aria-live="polite">{crosshair ? `Voxel ${crosshair.join(", ")} · ` : ""}{edits.length} queued</span>
        </div>
        <label>Reason for the correction (optional)<textarea value={note} maxLength={1000} rows={2} onChange={event => setNote(event.target.value)} placeholder="e.g. fragment outside the heart is not coronary" /></label>
        <Button type="button" size="sm" disabled={saving || (!chosen.length && !edits.length)} onClick={() => void save()}>{saving ? "Saving…" : `Save as new version${chosen.length ? ` (exclude ${chosen.length})` : ""}`}</Button>
      </div> : <p className="caption">Only doctors, clinicians and administrators with review access can save corrections.</p>}
      <h5 className="cv-subtitle">Saved versions</h5>
      {!data.versions.length ? <p className="muted">No corrections saved. The slice and 3D views show the model&apos;s original mask.</p> : <ul className="v3d-versions">
        <li><strong>Original model mask</strong><span>{data.components.reduce((sum, item) => sum + item.voxels, 0).toLocaleString()} voxels · never overwritten</span>
          <Button type="button" variant="outline" size="sm" aria-pressed={activeVersion === null} onClick={() => onUseVersion(null)}>{activeVersion === null ? "Showing" : "Show in slices"}</Button></li>
        {data.versions.map(item => <li key={item.version}><strong>Version {item.version}</strong>
          <span>{item.removed_components.length ? `Excluded components ${item.removed_components.join(", ")} · ` : ""}{item.voxel_edits?.length ?? 0} painted edits · {item.added_voxels ?? 0} added · {item.removed_voxels.toLocaleString()} removed · {item.reviewer_role} · {new Date(item.created_at).toLocaleString()}{item.note ? ` · ${item.note}` : ""}</span>
          <Button type="button" variant="outline" size="sm" aria-pressed={activeVersion === item.version} onClick={() => onUseVersion(item.version)}>{activeVersion === item.version ? "Showing" : "Show in slices"}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void download(item.version)}>NIfTI</Button></li>)}
      </ul>}
      <p className="caption">A correction records component exclusions and painted voxels; it does not change the model output, saved measurements or already exported reports. Versions are shown in the slice views; the 3D surface and measurements still use the original mask. Research review, not clinical validation.</p>
    </>}
  </section>;
}
