import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { User } from "../AccountPanel";
import type { SidebarView } from "../components/watermelon/macos-sidebar";
import type { SavedAccount } from "../demoSessions";
import { toast } from "../lib/toast";
import { canCreateCases } from "../permissions";
import { clearAnalysisLocation } from "../savedRunNavigation";
import { DEFAULT_SECTION, sectionForPath, sectionPath } from "../routes";
import { useAnalysisSession } from "./useAnalysisSession";
import { useCaseList } from "./useCaseList";
import { useCaseUpload } from "./useCaseUpload";
import { useNewCase } from "./useNewCase";

export type CaseSection = "overview" | "assets" | "reviews" | "history";

const FOCUS_DELAY_MS = 250;

export type WorkspaceSession = {
  token: string;
  user: User;
  onUser: (user: User) => void;
  savedAccounts: SavedAccount[];
  onSwitchAccount: (account: SavedAccount) => void;
  onSignOut: () => void;
  onClearSession: () => void;
};

function useWorkspaceState(session: WorkspaceSession) {
  const { token, user } = session;
  const location = useLocation();
  const navigate = useNavigate();
  const activeView = sectionForPath(location.pathname) ?? DEFAULT_SECTION;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [caseSection, setCaseSection] = useState<CaseSection>("overview");
  const [reviewWorkspace, setReviewWorkspace] = useState(false);

  /** Inline notice plus a toast, for completed actions (upload, analysis saved, case created). */
  function announce(message: string) {
    setNotice(message);
    if (message) toast.success(message);
  }

  /** Navigate to a section, keeping unrelated query parameters (e.g. ?design=) but not a saved-run location. */
  function setActiveView(view: SidebarView, options: { replace?: boolean } = {}) {
    const target = new URL(clearAnalysisLocation(window.location.href), window.location.origin);
    if (view === activeView && !options.replace) return;
    navigate({ pathname: sectionPath(view), search: target.search }, { replace: options.replace });
  }

  useEffect(() => { if (activeView === "uploads") setCaseSection("assets"); }, [activeView]);

  const caseList = useCaseList(token, user);
  const analysis = useAnalysisSession({ token, user, caseList, activeView, setActiveView, setError, setNotice: announce });
  const upload = useCaseUpload({
    token, selectedId: caseList.selectedId, selectedImage: analysis.selectedImage, loadCases: caseList.loadCases,
    onUploaded: (imageId) => { if (imageId) analysis.setSelectedImageId(imageId); analysis.clearSelectionResults(); },
    setBusy, setError, setNotice: announce,
  });
  const newCase = useNewCase({
    token, loadCases: caseList.loadCases,
    onCreated: (created) => { caseList.setSelectedId(created.id); setCaseSection("assets"); },
    setBusy, setError, setNotice: announce,
  });

  function selectCase(id: string) {
    caseList.setSelectedId(id);
    analysis.setSelectedImageId("");
  }

  /** Select a case from a list and leave the create/find panels. */
  function openCaseFromList(id: string) {
    caseList.setSelectedId(id);
    newCase.closeCasePanels();
    setError("");
  }

  function startNewCase() {
    if (!canCreateCases(user.role, user.permissions)) return;
    setActiveView("cases");
    newCase.setNewCaseOpen(true);
    newCase.setCaseFinderOpen(false);
    window.setTimeout(() => document.getElementById("case-code")?.focus(), FOCUS_DELAY_MS);
  }

  function startFindCase() {
    setActiveView("cases");
    newCase.setNewCaseOpen(false);
    newCase.setCaseFinderOpen(true);
    window.setTimeout(() => document.getElementById("case-search")?.focus(), FOCUS_DELAY_MS);
  }

  function caseDeleted(id: string) {
    caseList.setCases((items) => items.filter((item) => item.id !== id));
    caseList.setSelectedId("");
    analysis.setSelectedImageId("");
    analysis.clearSelectionResults();
    setActiveView("overview");
  }

  const selected = caseList.selected;
  const modalities = selected ? selected.modalities || [selected.modality] : [];
  const volumeOnly = !!selected && !modalities.includes("XCA");
  const volumeSupported = !!selected && modalities.some(
    (modality) => (selected.anatomy === "coronary" && modality === "CTA") ||
      (selected.anatomy === "aorta" && (modality === "CT" || modality === "CTA")),
  );

  return {
    session, token, user, activeView, setActiveView,
    error, setError, notice, setNotice, busy, setBusy,
    caseSection, setCaseSection, reviewWorkspace, setReviewWorkspace,
    caseList, analysis, upload, newCase,
    selected, volumeOnly, volumeSupported,
    selectCase, openCaseFromList, startNewCase, startFindCase, caseDeleted,
  };
}

export type Workspace = ReturnType<typeof useWorkspaceState>;

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ session, children }: { session: WorkspaceSession; children: ReactNode }) {
  const workspace = useWorkspaceState(session);
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return workspace;
}
