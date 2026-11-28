import { lazy, useEffect } from "react";
import { Button } from "../components/prismui/button";
import { useWorkspace } from "../workspace/WorkspaceContext";

const VolumeInference = lazy(() => import("../VolumeInference"));

/** Volume-only cases (no XCA frames) use the 3D workspace in place of the 2D analysis and reports pages. */
export default function VolumeWorkspace({ landing }: { landing?: "reports" } = {}) {
  const { token, caseList, selected, volumeOnly, volumeSupported, selectCase, setCaseSection, setActiveView } = useWorkspace();
  const selectedId = selected?.id;
  // Opening Reports & exports lands on the reports block of the 3D case once the saved run has loaded.
  useEffect(() => {
    if (landing !== "reports" || !selectedId) return;
    let done = false;
    const jump = () => {
      const target = document.getElementById("v3d-reports");
      if (!target || done) return;
      done = true; observer.disconnect();
      target.style.scrollMarginTop = "8rem";
      target.scrollIntoView({ behavior: "auto", block: "start" });
    };
    const observer = new MutationObserver(jump);
    observer.observe(document.body, { childList: true, subtree: true });
    jump();
    const stop = window.setTimeout(() => observer.disconnect(), 20000);
    return () => { observer.disconnect(); window.clearTimeout(stop); };
  }, [landing, selectedId]);
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
