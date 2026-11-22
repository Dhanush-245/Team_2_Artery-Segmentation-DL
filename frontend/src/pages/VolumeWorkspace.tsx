import { lazy } from "react";
import { Button } from "../components/prismui/button";
import { useWorkspace } from "../workspace/WorkspaceContext";

const VolumeInference = lazy(() => import("../VolumeInference"));

/** Volume-only cases (no XCA frames) use the 3D workspace in place of the 2D analysis and reports pages. */
export default function VolumeWorkspace() {
  const { token, caseList, selected, volumeOnly, volumeSupported, selectCase, setCaseSection, setActiveView } = useWorkspace();
  if (!volumeOnly || !selected) return null;
  return <section className="volume-workspace" aria-labelledby="volume-workspace-title">
    <div className="page-heading">
      <div><p className="eyebrow">IMAGING WORKSPACE · 3D</p><h2 id="volume-workspace-title">{selected.modality} volume analysis</h2></div>
      <span className="stage-badge">Research only</span>
    </div>
    <div className="workbench-selectors volume-workspace-bar">
      <label>Case<select value={selected.id} onChange={event => selectCase(event.target.value)}>
        {caseList.cases.map(item => <option key={item.id} value={item.id}>{item.case_code} · {item.modality}</option>)}
      </select></label>
      <Button variant="outline" onClick={() => { setCaseSection("assets"); setActiveView("cases"); }}>Upload or prepare a volume</Button>
    </div>
    {volumeSupported ? <VolumeInference caseId={selected.id} token={token} anatomy={selected.anatomy} readOnly />
      : <p className="caption">Volume preparation is available for this case, but no segmentation model supports its anatomy yet.</p>}
  </section>;
}
