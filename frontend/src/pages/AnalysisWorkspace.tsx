import { lazy } from "react";
import { Button } from "../components/prismui/button";
import Alert1 from "../components/watermelon/alert-1";
import { canCreateCases } from "../permissions";
import { useWorkspace } from "../workspace/WorkspaceContext";
import VolumeWorkspace from "./VolumeWorkspace";

const AnalysisWorkbench = lazy(() => import("../AnalysisWorkbench"));
const ReviewAssessment = lazy(() => import("../ReviewAssessment"));

export function WorkspaceAlerts() {
  const { error, setError, notice, setNotice } = useWorkspace();
  return <>
    {error && <Alert1 tone="error" title="Action could not be completed" onDismiss={() => setError("")}>{error}</Alert1>}
    {notice && <Alert1 tone="success" title="Update completed" onDismiss={() => setNotice("")}>{notice}</Alert1>}
  </>;
}

/** 2D analysis workbench, shared by /analysis and the review workspace under /reviews. */
export default function AnalysisWorkspace({ reviewMode }: { reviewMode: boolean }) {
  const { token, user, caseList, analysis: run, selected, volumeOnly, selectCase, setActiveView, setReviewWorkspace } = useWorkspace();
  const { selectedImage, selectedAnalysis, imageAnalysis } = run;
  return <>
    <WorkspaceAlerts />
    {reviewMode && <Button variant="outline" onClick={() => setReviewWorkspace(false)}>Back to review queue</Button>}
    {!volumeOnly && <AnalysisWorkbench onImageReview={() => setActiveView("analysis")} reviewMode={reviewMode}
      assessment={reviewMode && selected ? <ReviewAssessment key={`${selected.id}:${run.analysis?.id}`} token={token} role={user.role} caseRecord={selected} analysis={imageAnalysis} onSaved={caseList.replaceCase} /> : undefined}
      onReview={selected?.permissions?.can_review ? () => { setReviewWorkspace(true); setActiveView("reviews"); } : undefined}
      token={token} cases={caseList.cases} selectedCase={selected} selectedImage={selectedImage} processedPreview={run.previewOwner === selectedImage?.id ? run.preview : ""}
      overlay={selectedAnalysis ? run.overlay : ""} analysis={selectedAnalysis}
      history={run.imageHistory} modelsReady={run.modelsReady} analysisBusy={run.analysisBusy}
      jobStatus={run.analysisJob?.status} canRunAnalysis={selected?.permissions?.can_run_analysis ?? canCreateCases(user.role)}
      onCaseChange={selectCase} onImageChange={run.setSelectedImageId}
      onRun={run.handleAnalysis} onSelectAnalysis={run.showAnalysis} onUpload={() => setActiveView("cases")} onReports={() => setActiveView("reports")} />}
    <VolumeWorkspace />
  </>;
}
