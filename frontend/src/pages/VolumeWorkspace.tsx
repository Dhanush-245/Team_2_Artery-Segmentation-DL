import { lazy } from "react";
import { Button } from "../components/prismui/button";
import { useWorkspace } from "../workspace/WorkspaceContext";

const VolumeInference = lazy(() => import("../VolumeInference"));

/** Volume-only cases (no XCA frames) use the 3D workspace in place of the 2D analysis and reports pages. */
export default function VolumeWorkspace() {
  const { token, caseList, selected, volumeOnly, volumeSupported, selectCase, setCaseSection, setActiveView } = useWorkspace();
  if (!volumeOnly || !selected) return null;
  return <section>
    <h2>{selected.case_code} · Volume workspace</h2>
    <label>Case <select value={selected.id} onChange={event => selectCase(event.target.value)}>
      {caseList.cases.map(item => <option key={item.id} value={item.id}>{item.case_code} · {item.modality}</option>)}
    </select></label>
    <Button variant="outline" onClick={() => { setCaseSection("assets"); setActiveView("cases"); }}>Assets &amp; preparation</Button>
    {volumeSupported ? <VolumeInference caseId={selected.id} token={token} anatomy={selected.anatomy} readOnly />
      : <p>Volume preparation is available. This case has no supported segmentation model.</p>}
  </section>;
}
