import { Button } from "../components/prismui/button";
import { Input } from "../components/prismui/input";
import Alert1 from "../components/watermelon/alert-1";
import { CreateNewDisclosure } from "../components/watermelon/create-new-disclosure";
import { caseAnatomies, caseTasks, taskLabel } from "../caseConfiguration";
import { canCreateCases } from "../permissions";
import ScreenShareSelect from "../ScreenShareSelect";
import type { CaseSort } from "../workspace/useCaseList";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { analysisSummaryLabel, caseStatusLabel } from "../caseTypes";

function emptyFindMessage(hasCases: boolean) {
  if (hasCases) return "No cases match your filters.";
  return "No accessible cases yet. Create a de-identified study or ask your administrator to check the workspace access policy.";
}

function FindCase() {
  const { caseList, openCaseFromList } = useWorkspace();
  const { cases, matchingCases, visibleCases, caseSearch, setCaseSearch, caseStatus, setCaseStatus, caseSort, setCaseSort,
    caseModality, setCaseModality, caseTaskFilter, setCaseTaskFilter, casePage, setCasePage, pageCount, currentPage, casesPerPage } = caseList;
  return <>
    <div className="case-list-controls">
      <label className="sr-only" htmlFor="case-search">Search cases</label>
      <Input id="case-search" value={caseSearch} onChange={(event) => { setCaseSearch(event.target.value); setCasePage(1); }} placeholder="Search case or patient ID" />
      <div><label className="sr-only" htmlFor="case-filter">Filter by status</label><ScreenShareSelect id="case-filter" value={caseStatus} onChange={(event) => { setCaseStatus(event.target.value); setCasePage(1); }}><option value="all">All statuses</option>{[...new Set(cases.map((item) => item.status))].map((status) => <option value={status} key={status}>{status}</option>)}</ScreenShareSelect>
      <label className="sr-only" htmlFor="case-sort">Sort cases</label><ScreenShareSelect id="case-sort" value={caseSort} onChange={(event) => setCaseSort(event.target.value as CaseSort)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="code">Case ID</option></ScreenShareSelect></div>
    </div>
    <div className="case-list-controls"><label>Modality<ScreenShareSelect label="Modality" value={caseModality} onChange={e => { setCaseModality(e.target.value); setCasePage(1); }}><option value="all">All modalities</option>{[...new Set(cases.map(c => c.modality))].map(v => <option key={v}>{v}</option>)}</ScreenShareSelect></label><label>Research task<ScreenShareSelect label="Research task" value={caseTaskFilter} onChange={e => { setCaseTaskFilter(e.target.value); setCasePage(1); }}><option value="all">All tasks</option>{caseTasks.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</ScreenShareSelect></label></div>
    <section className="case-find-results" aria-label="Case search results"><h2>Search results <span>({matchingCases.length})</span></h2>
      {visibleCases.length ? visibleCases.map(item => <button type="button" key={item.id} onClick={() => openCaseFromList(item.id)}><strong>{item.case_code}</strong><span>{item.modality} · {item.anatomy} · {caseStatusLabel(item)} · {analysisSummaryLabel(item.analysis_summary)}</span><small>{(item.intended_tasks || [item.intended_task]).map(taskLabel).join(", ")}</small><span>Open case →</span></button>) : <p className="muted">{emptyFindMessage(cases.length > 0)}</p>}
      {matchingCases.length > casesPerPage && <div className="case-pagination"><Button type="button" variant="outline" disabled={casePage <= 1} onClick={() => setCasePage(page => page - 1)}>Previous</Button><span>{currentPage} / {pageCount}</span><Button type="button" variant="outline" disabled={casePage >= pageCount} onClick={() => setCasePage(page => page + 1)}>Next</Button></div>}
    </section>
  </>;
}

function CreateCase() {
  const { error, busy, newCase } = useWorkspace();
  const { caseCode, setCaseCode, newModality, changeModality, newAnatomy, setNewAnatomy, newTasks, setNewTasks, newSource, setNewSource, handleNewCase } = newCase;
  return <form onSubmit={handleNewCase} className="new-case">
    <label className="case-code-field" htmlFor="case-code">New case code<Input id="case-code" placeholder="e.g. CASE-001" maxLength={80} value={caseCode} onChange={(e) => setCaseCode(e.target.value)} required /></label>
    <label>Modality<ScreenShareSelect label="Modality" value={newModality} onChange={e => changeModality(e.target.value)}><option value="XCA">X-ray angiography</option><option value="CTA">CT angiography</option><option value="CT">CT</option><option value="MRA">MR angiography</option></ScreenShareSelect></label>
    <label>Anatomy<ScreenShareSelect label="Anatomy" value={newAnatomy} onChange={e => setNewAnatomy(e.target.value)}>{caseAnatomies.filter(v => newModality !== "XCA" || v === "coronary").map(v => <option key={v}>{v}</option>)}</ScreenShareSelect></label>
    <label>Intended tasks<ScreenShareSelect label="Intended tasks" value={newTasks[0] || ""} multiple values={newTasks} onValuesChange={setNewTasks} onChange={e => setNewTasks([e.target.value])}>{caseTasks.filter(([id]) => newModality === "XCA" ? id !== "volume_preparation" : id === "volume_preparation").map(([id, title]) => <option key={id} value={id}>{title}</option>)}</ScreenShareSelect></label>
    <label>Source dataset or release<Input value={newSource} maxLength={120} onChange={e => setNewSource(e.target.value)} placeholder="e.g. ARCADE official release" /></label>
    <Button className="primary" disabled={busy}>{busy ? "Creating…" : "Create research case"}</Button>
    {error && <Alert1 tone="error" title="Case could not be created">{error}</Alert1>}
  </form>;
}

/** "Create a research case" / "Find a case" panel shown inside /cases. */
export default function CaseActionsPage() {
  const { user, newCase } = useWorkspace();
  const { newCaseOpen, caseFinderOpen, setNewCaseOpen, setCaseFinderOpen, closeCasePanels } = newCase;
  const canCreate = canCreateCases(user.role, user.permissions);
  return <section className="cv-case-page" aria-label={newCaseOpen ? "Create case workspace" : "Find case workspace"}>
    <header className="cv-case-page-heading"><div><p className="eyebrow">CASE WORKSPACE</p><h1>{newCaseOpen ? "Create a research case" : "Find a case"}</h1><p>{newCaseOpen ? "Register a de-identified study, then add images and prepare them for analysis." : "Search and filter the cases you are authorized to access."}</p></div><Button type="button" variant="outline" onClick={closeCasePanels}>Back to case workspace</Button></header>
    <CreateNewDisclosure mode={newCaseOpen && canCreate ? "create" : caseFinderOpen ? "find" : null}
      canCreate={canCreate}
      onModeChange={mode => { setNewCaseOpen(mode === "create"); setCaseFinderOpen(mode === "find"); }}
      findContent={<FindCase />}
      createContent={<CreateCase />} />
  </section>;
}
