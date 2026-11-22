import { lazy } from "react";
import { Button } from "../components/prismui/button";
import { Card } from "../components/prismui/card";
import type { CaseRecord } from "../caseTypes";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { volumeInferenceEligible } from "./CaseAssetsPanel";

const AnalysisHistory = lazy(() => import("../AnalysisHistory"));
const TaskInference = lazy(() => import("../TaskInference"));
const VolumeInference = lazy(() => import("../VolumeInference"));

function LatestAnalysisCard() {
  const { analysis: run, setActiveView } = useWorkspace();
  const { selectedImage, selectedAnalysis, overlay, analysis } = run;
  if (!selectedImage) return null;
  return <Card className="panel analysis-panel">
    <div className="viewer-heading">
      <div className="cv-panel-head"><span className="eyebrow">LATEST 2D ANALYSIS</span><h3>AI vessel analysis</h3><p className="muted">Artery outline, vessel measurements and possible narrowing for {selectedImage.original_name}.</p></div>
      <span className="cv-chip info">Research only</span>
    </div>
    <div className="cv-actions"><span className="cv-actions-label">Source image</span><span className="caption">Choose a different image under Assets &amp; preparation to inspect its history.</span><Button type="button" size="sm" className="primary" onClick={() => setActiveView("analysis")}>{selectedAnalysis ? "View combined findings" : "Open analysis"}</Button></div>
    {overlay && <div className="analysis-overlay"><img src={overlay} alt="Research artery and stenosis mask overlay" /><p className="caption">Cyan: predicted artery · Coral: predicted stenosis</p></div>}
    {analysis && <div className="analysis-details">
      <p><strong>Model:</strong> {analysis.model_version}</p>
      <p><strong>Predicted mask pixels:</strong> artery {analysis.artery_pixels.toLocaleString()} · stenosis {analysis.stenosis_pixels.toLocaleString()}</p>
      <p>{analysis.interpretation}</p>
      <p className="caption">Validation Dice: artery {analysis.validation.syntax?.validation_dice ?? "unavailable"} · stenosis {analysis.validation.stenosis?.validation_dice ?? "unavailable"}. Baseline validation is limited and is not clinical accuracy.</p>
    </div>}
  </Card>;
}

/** "Analysis history" tab of a case: 3D runs, task runs and saved 2D runs. */
export default function CaseHistoryPanel({ record }: { record: CaseRecord }) {
  const { token, analysis: run, setActiveView } = useWorkspace();
  const { selectedImage, history, showAnalysis } = run;
  return <>
    {volumeInferenceEligible(record) && <VolumeInference caseId={record.id} token={token} anatomy={record.anatomy} readOnly historyOnly onOpenAnalysis={() => setActiveView("analysis")} />}
    {record.anatomy === "coronary" && (record.modalities || [record.modality]).includes("XCA") && <TaskInference key={record.id + ":tasks"} caseId={record.id} token={token} />}
    {!selectedImage && record.modality === "XCA" && <Card className="panel"><h3>No 2D analysis history yet</h3><p>Prepare a supported 2D image first. 3D results, when available, are listed separately.</p></Card>}
    <LatestAnalysisCard />
    {selectedImage && <AnalysisHistory imageId={selectedImage.id} token={token} history={history} onSelect={showAnalysis} />}
  </>;
}
