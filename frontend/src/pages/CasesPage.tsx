import { lazy } from "react";
import { Button } from "../components/prismui/button";
import { taskLabel } from "../caseConfiguration";
import { canOpenSection } from "../permissions";
import { useWorkspace, type CaseSection } from "../workspace/WorkspaceContext";
import { WorkspaceAlerts } from "./AnalysisWorkspace";
import CaseActionsPage from "./CaseActionsPage";
import CaseAssetsPanel from "./CaseAssetsPanel";
import CaseHistoryPanel from "./CaseHistoryPanel";

const CaseDetails = lazy(() => import("../CaseDetails"));
const CaseWorkflow = lazy(() => import("../CaseWorkflow"));

const CASE_SECTIONS: [CaseSection, string][] = [["overview", "Overview & access"], ["assets", "Assets & preparation"], ["reviews", "Reviews & notes"], ["history", "Analysis history"]];
const PREVIOUS_SECTION: Record<CaseSection, CaseSection> = { overview: "overview", assets: "overview", reviews: "assets", history: "reviews" };

/** The eyebrow repeats the sidebar name of the page, so Case Inventory is never labelled as Data & Uploads. */
function roleCopy(role: string, view: string) {
  const clinical = role === "doctor" || role === "clinician";
  const cases = clinical ? "RESEARCH CASES" : role === "technician" ? "CASE INTAKE" : role === "viewer" ? "ASSIGNED CASES" : role === "admin" ? "CASE INVENTORY" : "RESEARCH CASES";
  return {
    eyebrow: view === "uploads" ? "DATA & UPLOADS" : cases,
    badge: clinical ? "Clinical workspace" : role === "viewer" ? "Read-only view" : "Research workspace",
  };
}

function CaseStepNavigation() {
  const { user, busy, caseSection, setCaseSection, setActiveView, upload, analysis: run } = useWorkspace();
  if (caseSection === "overview") return null;
  return <nav className="case-bottom-navigation case-step-navigation" aria-label="Case workflow navigation">
    <Button type="button" variant="outline" onClick={() => setCaseSection(PREVIOUS_SECTION[caseSection])}>← Previous</Button>
    {caseSection === "assets" && <Button type="button" className="primary" disabled={busy || !!upload.uploadProgress} onClick={() => setCaseSection("reviews")}>Next: Reviews &amp; notes →</Button>}
    {caseSection === "reviews" && <Button type="button" className="primary" onClick={() => setCaseSection("history")}>Next: Analysis history →</Button>}
    {caseSection === "history" && canOpenSection("reports", user.role, user.permissions) && <Button type="button" className="primary" disabled={run.analysisBusy} onClick={() => setActiveView("reports")}>Next: Reports →</Button>}
  </nav>;
}

/** /cases and /uploads: the selected case's workflow tabs. */
export default function CasesPage() {
  const { token, user, activeView, setActiveView, selected, caseSection, setCaseSection, newCase, caseList, analysis: run, caseDeleted } = useWorkspace();
  if (activeView === "cases" && (newCase.newCaseOpen || newCase.caseFinderOpen)) return <CaseActionsPage />;
  const copy = roleCopy(user.role, activeView);
  return <>
    <div className="page-heading">
      <div><p className="eyebrow">{copy.eyebrow}</p><h2>{selected ? selected.case_code : "Select a case"}</h2></div>
      <span className="stage-badge">{copy.badge}</span>
    </div>
    <WorkspaceAlerts />
    {selected?.visibility === "shared" && <p className="muted">Shared team case · visible to all active case-workspace users. Available actions follow your role.</p>}
    {selected && <><p className="muted">{selected.modality} · {selected.anatomy} · {(selected.intended_tasks || [selected.intended_task]).map(taskLabel).join(", ")} · {selected.source_dataset || "Source not recorded"}</p><nav className="case-section-nav" aria-label="Case sections">{CASE_SECTIONS.map(([id, title]) => <Button key={id} type="button" variant={caseSection === id ? "default" : "outline"} aria-pressed={caseSection === id} onClick={() => setCaseSection(id)}>{title}</Button>)}<Button type="button" variant="outline" onClick={() => setActiveView("analysis")}>Open analysis</Button><Button type="button" variant="outline" onClick={() => setActiveView("reports")}>Reports</Button></nav></>}
    {!selected ? (
      <div className="placeholder">{user.role === "viewer" ? "Select an accessible case from the sidebar to view." : "Create a de-identified case to upload an angiography image."}</div>
    ) : (
      <div className={`analysis-grid ${caseSection === "assets" ? "case-assets-layout" : ""}`}>
        {caseSection === "overview" && <CaseWorkflow caseRecord={selected} token={token} role={user.role}
          onUpdated={caseList.replaceCase} onDeleted={caseDeleted} onNext={() => setCaseSection("assets")}>
          <CaseDetails key={`${selected.id}:overview`} section="overview" caseRecord={selected} token={token} modelVersion={run.analysis?.model_version} userRole={user.role} currentUserId={user.id}
            onSaved={caseList.replaceCase} />
        </CaseWorkflow>}
        {caseSection === "reviews" && <CaseDetails key={`${selected.id}:${caseSection}`} section={caseSection} caseRecord={selected} token={token} modelVersion={run.analysis?.model_version} userRole={user.role} currentUserId={user.id}
          onSaved={caseList.replaceCase} />}
        {caseSection === "assets" && <CaseAssetsPanel record={selected} />}
        {caseSection === "history" && <CaseHistoryPanel record={selected} />}
        <CaseStepNavigation />
      </div>
    )}
    <p className="footer-note">Research prototype · AI masks require expert review and are not a clinical diagnosis.</p>
  </>;
}
