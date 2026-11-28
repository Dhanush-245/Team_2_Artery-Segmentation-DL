import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import ReportsPage from "../ReportsPage";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { ReportsCasePicker, VolumeReportBuilder } from "./ReportsHub";

/** Reports & exports: choose any case, then build its report here (2D image report or 3D volume report). */
export default function ReportsRoutePage() {
  const { token, user, caseList, analysis: run, selected, volumeOnly, selectCase, setActiveView } = useWorkspace();
  const [params] = useSearchParams();
  const queryCase = params.get("case_id");
  useEffect(() => {
    if (queryCase && queryCase !== selected?.id && caseList.cases.some(item => item.id === queryCase)) selectCase(queryCase);
  }, [queryCase, selected?.id, caseList.cases, selectCase]);
  return <div className="reports-hub">
    <ReportsCasePicker cases={caseList.cases} selectedId={selected?.id} onSelect={selectCase} />
    {!selected ? null : volumeOnly
      ? <VolumeReportBuilder token={token} record={selected} preferredRunId={params.get("run_id")}
          onOpenAnalysis={() => setActiveView("analysis")} onOpenUploads={() => setActiveView("uploads")} />
      : <ReportsPage token={token} role={user.role} cases={caseList.cases} selectedCase={selected} selectedImage={run.selectedImage}
          analysis={run.imageAnalysis} history={run.imageHistory} onSelectAnalysis={run.showAnalysis}
          onCaseChange={selectCase} onImageChange={run.setSelectedImageId} onAnalysis={() => setActiveView("analysis")} />}
  </div>;
}
