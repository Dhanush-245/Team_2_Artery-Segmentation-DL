import ReportsPage from "../ReportsPage";
import { useWorkspace } from "../workspace/WorkspaceContext";
import VolumeWorkspace from "./VolumeWorkspace";

export default function ReportsRoutePage() {
  const { token, user, caseList, analysis: run, selected, volumeOnly, selectCase, setActiveView } = useWorkspace();
  if (volumeOnly) return <VolumeWorkspace landing="reports" />;
  return <ReportsPage token={token} role={user.role} cases={caseList.cases} selectedCase={selected} selectedImage={run.selectedImage}
    analysis={run.imageAnalysis} history={run.imageHistory} onSelectAnalysis={run.showAnalysis}
    onCaseChange={selectCase} onImageChange={run.setSelectedImageId} onAnalysis={() => setActiveView("analysis")} />;
}
