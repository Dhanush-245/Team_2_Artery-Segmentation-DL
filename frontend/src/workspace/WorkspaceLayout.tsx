import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import CommandPalette, { buildCommands } from "../components/CommandPalette";
import ErrorBoundary from "../components/ErrorBoundary";
import { Button } from "../components/prismui/button";
import LoadingScreen from "../components/LoadingScreen";
import Toaster from "../components/Toaster";
import type { SidebarView } from "../components/watermelon/macos-sidebar";
import { MacOSSidebar } from "../components/watermelon/macos-sidebar";
import { SwitchMode } from "../components/watermelon/switch-mode";
import { taskLabel } from "../caseConfiguration";
import NotificationBell from "../NotificationBell";
import { canCreateCases, canOpenSection } from "../permissions";
import { DEFAULT_SECTION, SECTION_PATHS, sectionPath } from "../routes";
import { SECTION_META } from "../sectionMeta";
import { useDocumentTitle } from "./SectionHeader";
import { useWorkspace } from "./WorkspaceContext";
import { caseStatusLabel } from "../caseTypes";

const ViewerWorkspace = lazy(() => import("../ViewerWorkspace"));

export const SectionLoading = () => <LoadingScreen label="Loading workspace section…" />;

/** Sections a viewer sees directly; everything else is presented through the read-only viewer portal. */
/** These pages already show their own visible h1; every other section gets a screen-reader heading. */
const SECTIONS_WITH_VISIBLE_H1: SidebarView[] = ["overview", "cases", "uploads"];
const VIEWER_DIRECT_SECTIONS: SidebarView[] = ["account"];

function SidebarCaseList() {
  const { user, caseList, newCase, startNewCase, startFindCase, openCaseFromList } = useWorkspace();
  const { cases, matchingCases, visibleCases, selectedId, casePage, setCasePage, pageCount, currentPage, casesPerPage } = caseList;
  return (
    <>
      <h1>Cases</h1>
      <div className="sidebar-case-actions">
        {canCreateCases(user.role, user.permissions) && <Button type="button" variant={newCase.newCaseOpen ? "default" : "outline"} onClick={startNewCase}>Create case</Button>}
        <Button type="button" variant={newCase.caseFinderOpen ? "default" : "outline"} onClick={startFindCase}>Find case</Button>
      </div>
      <div className="case-list" role="list" aria-label="Cases">
        {matchingCases.length === 0 && <p className="empty">{cases.length ? "No cases match your filters." : user.role === "admin" ? "No cases assigned to you yet. Administrators see only cases they own or are assigned." : "No accessible cases yet."}</p>}
        {visibleCases.map((item) => (
          <button key={item.id} className={`case-item ${selectedId === item.id ? "active" : ""}`} onClick={() => openCaseFromList(item.id)}>
            <strong>{item.case_code}</strong>
            <span>{item.modality} · {item.anatomy} · {caseStatusLabel(item)}</span><small>{(item.intended_tasks || [item.intended_task]).map(taskLabel).join(", ")}</small>
          </button>
        ))}
      </div>
      {matchingCases.length > casesPerPage && <div className="case-pagination"><button type="button" disabled={casePage <= 1} onClick={() => setCasePage((page) => page - 1)}>Previous</button><span>{currentPage} / {pageCount}</span><button type="button" disabled={casePage >= pageCount} onClick={() => setCasePage((page) => page + 1)}>Next</button></div>}
    </>
  );
}

/** Shell for every signed-in section: top bar, sidebar navigation and the routed page. */
export default function WorkspaceLayout() {
  const workspace = useWorkspace();
  const { token, user, session, activeView, setActiveView, caseList, selected, selectCase, startNewCase, startFindCase } = workspace;
  const location = useLocation();
  const contentRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  useDocumentTitle(activeView);
  // After in-app navigation, move keyboard and screen-reader focus to the new page instead of leaving it in the sidebar.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    contentRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);
  const commands = useMemo(() => buildCommands({
    sections: (Object.keys(SECTION_PATHS) as SidebarView[]).filter((view) => canOpenSection(view, user.role, user.permissions)),
    cases: caseList.cases,
    openSection: (view) => setActiveView(view),
    openCase: (id) => { selectCase(id); setActiveView("cases"); },
    actions: [
      ...(canCreateCases(user.role, user.permissions) ? [{ id: "action:new-case", group: "Actions" as const, label: "Create a research case", run: startNewCase }] : []),
      ...(canOpenSection("cases", user.role, user.permissions) ? [{ id: "action:find-case", group: "Actions" as const, label: "Find a case", hint: "Search and filter authorized cases", run: startFindCase }] : []),
    ],
  }), [caseList.cases, user.role, user.permissions, activeView]);

  if (!canOpenSection(activeView, user.role, user.permissions)) {
    return <Navigate to={{ pathname: sectionPath(DEFAULT_SECTION), search: location.search }} replace />;
  }

  const content = user.role === "viewer" && !VIEWER_DIRECT_SECTIONS.includes(activeView)
    ? <ViewerWorkspace cases={caseList.cases} selected={selected} onSelect={caseList.setSelectedId} page={activeView === "overview" ? "overview" : "cases"} onCases={() => setActiveView("cases")} onSettings={() => setActiveView("account")} />
    : <Outlet />;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); contentRef.current?.focus(); }}>Skip to content</a>
      <header className="topbar">
        <a className="brand" href={sectionPath(DEFAULT_SECTION)} aria-label="CoroVision AI, go to the dashboard" onClick={(event) => { event.preventDefault(); setActiveView(DEFAULT_SECTION); }}><span className="brand-mark" aria-hidden="true"><img src="/corovision-heart-mark.png" alt="" /></span><span>CoroVision AI <small>VASCULAR IMAGING RESEARCH</small></span></a>
        <div className="account"><CommandPalette commands={commands} /><NotificationBell key={user.id} token={token} onOpenCase={(id) => { selectCase(id); setActiveView("cases"); }} /><div className="theme-switch"><SwitchMode width={76} height={38} /></div></div>
      </header>
      <main className="workspace">
        <MacOSSidebar activeView={activeView} onViewChange={(view) => setActiveView(view)} user={user} role={user.role} onNewCase={startNewCase} onLogout={session.onSignOut}
          savedAccounts={session.savedAccounts} onSwitchAccount={session.onSwitchAccount}>
          <SidebarCaseList />
        </MacOSSidebar>
        <section className={activeView === "analysis" ? "content analysis-content" : "content"} id="main-content" ref={contentRef} tabIndex={-1} aria-label={SECTION_META[activeView].title}>
          <p className="sr-only" role="status" aria-live="polite">{SECTION_META[activeView].title}</p>
          {!SECTIONS_WITH_VISIBLE_H1.includes(activeView) && <h1 className="sr-only">{SECTION_META[activeView].title}</h1>}
          <ErrorBoundary label={SECTION_META[activeView].title} resetKey={location.pathname}>
            <Suspense fallback={<SectionLoading />}>{content}</Suspense>
          </ErrorBoundary>
        </section>
      </main>
      <Toaster />
    </div>
  );
}
