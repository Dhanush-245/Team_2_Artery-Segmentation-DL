import OverviewPanel from "../OverviewPanel";
import RoleWorkspace from "../RoleWorkspace";
import { useWorkspace } from "../workspace/WorkspaceContext";

export default function OverviewPage() {
  const { token, user, caseList, setActiveView, startNewCase, startFindCase } = useWorkspace();
  if (user.role === "admin" || user.role === "ml_engineer") return <RoleWorkspace role={user.role} onOpen={setActiveView} />;
  return (
    <OverviewPanel
      token={token}
      user={user}
      cases={caseList.cases}
      onNewCase={startNewCase}
      onViewCases={startFindCase}
      onOpenCase={(id) => { caseList.setSelectedId(id); setActiveView("cases"); }}
      onOpenTask={(id, view) => { caseList.setSelectedId(id); setActiveView(view === "analysis" ? "analysis" : "cases"); }}
      onViewAnalysis={() => setActiveView("analysis")}
      onViewReports={() => setActiveView("reports")}
      onViewModels={() => setActiveView("models")}
      onOpenWorkspace={setActiveView}
    />
  );
}
