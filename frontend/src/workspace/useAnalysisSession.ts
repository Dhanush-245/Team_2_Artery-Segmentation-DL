import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { apiUrl, request } from "../api";
import type { User } from "../AccountPanel";
import type { AnalysisJob, AnalysisResult } from "../caseTypes";
import type { SidebarView } from "../components/watermelon/macos-sidebar";
import { canOpenSection } from "../permissions";
import { toast } from "../lib/toast";
import { runForImage } from "../reviewEvidence";
import { analysisLocation, clearAnalysisLocation, pinnedRunForImage, savedImageForRequest, type SavedRunPin } from "../savedRunNavigation";
import type { CaseList } from "./useCaseList";

const JOB_POLL_MS = 1000;

type NavigationTarget = { caseId: string; imageId: string | null };

function requestedTarget(search: string): { target: NavigationTarget | null; runId: string | null } {
  const params = new URLSearchParams(search);
  const caseId = params.get("case_id");
  return { target: caseId ? { caseId, imageId: params.get("image_id") } : null, runId: params.get("run_id") };
}

type Options = {
  token: string;
  user: User;
  caseList: CaseList;
  activeView: SidebarView;
  setActiveView: (view: SidebarView, options?: { replace?: boolean }) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
};

/**
 * Selected image, its preview, saved runs and the analysis job lifecycle.
 * Deep links (?case_id=&image_id=&run_id=) are resolved only against the
 * server-authorized case list for this exact session.
 */
export function useAnalysisSession({ token, user, caseList, activeView, setActiveView, setError, setNotice }: Options) {
  const { cases, selected, setSelectedId, caseListToken, loadCases } = caseList;
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [selectedImageId, setSelectedImageId] = useState("");
  const [preview, setPreview] = useState("");
  const [previewOwner, setPreviewOwner] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [overlay, setOverlay] = useState("");
  const [modelsReady, setModelsReady] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(null);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const initial = useRef(requestedTarget(window.location.search));
  const requestedCaseNavigation = useRef<NavigationTarget | null>(initial.current.target);
  const requestedRun = useRef<string | null>(initial.current.runId);
  const pinnedRun = useRef<SavedRunPin | null>(null);
  const restorationImage = useRef<string | null>(null);
  const announcedJobRef = useRef<string | null>(null);
  const overlayRequest = useRef(0);

  const selectedImage = selected?.images.find((item) => item.id === selectedImageId) || selected?.images.at(-1);
  const selectedAnalysis = runForImage(selectedImage?.id, analysis);
  const selectedImageRef = useRef(selectedImage?.id);
  selectedImageRef.current = selectedImage?.id;
  const currentRef = useRef({ caseId: selected?.id, runId: selectedAnalysis?.id });
  currentRef.current = { caseId: selected?.id, runId: selectedAnalysis?.id };

  useEffect(() => () => { if (overlay.startsWith("blob:")) URL.revokeObjectURL(overlay); }, [overlay]);

  // Back/forward onto a saved-run URL re-selects that run instead of rewriting the URL to the current one.
  useEffect(() => {
    if (navigationType !== "POP" || activeView !== "analysis") return;
    const { target, runId } = requestedTarget(location.search);
    if (!target) return;
    const current = currentRef.current;
    if (target.caseId === current.caseId && target.imageId === selectedImageRef.current && (!runId || runId === current.runId)) return;
    requestedCaseNavigation.current = target;
    requestedRun.current = runId;
    setNavigationRequest((count) => count + 1);
  }, [location.key]);

  useEffect(() => {
    const target = requestedCaseNavigation.current;
    if (!target || caseListToken !== token || new URLSearchParams(location.search).has("demo_role")) return;
    const allowedCase = cases.find((item) => item.id === target.caseId);
    requestedCaseNavigation.current = null;
    const cleanPath = clearAnalysisLocation(window.location.href);
    if (!allowedCase || !canOpenSection("analysis", user.role, user.permissions)) {
      requestedRun.current = null;
      navigate(cleanPath, { replace: true });
      setError("The requested analysis case is unavailable for this account.");
      return;
    }
    // Volume-only cases (CT/CTA/MRA) have no 2D frames; the case link alone opens the 3D workspace.
    if (!allowedCase.images.length && !target.imageId) {
      requestedRun.current = null;
      setSelectedId(allowedCase.id);
      setActiveView("analysis", { replace: true });
      return;
    }
    const image = savedImageForRequest(allowedCase.images, target.imageId, requestedRun.current);
    if (!image) {
      requestedRun.current = null;
      navigate(cleanPath, { replace: true });
      setError("The requested study image is unavailable for this account.");
      return;
    }
    setSelectedId(allowedCase.id);
    pinnedRun.current = requestedRun.current ? { imageId: image.id, runId: requestedRun.current } : null;
    requestedRun.current = null;
    restorationImage.current = image.id;
    setSelectedImageId(image.id);
    setActiveView("analysis", { replace: true });
  }, [cases, caseListToken, token, location.search, navigationRequest]);

  useEffect(() => {
    const item = selectedImage;
    if (!item || !token) {
      setPreview("");
      return;
    }
    setPreview("");
    let active = true;
    let objectUrl = "";
    fetch(apiUrl(item.preview_url), { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load preview");
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) { setPreviewOwner(item.id); setPreview(objectUrl); }
      })
      .catch((cause: Error) => setError(cause.message));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedImage?.id, token]);

  useEffect(() => {
    if (requestedCaseNavigation.current || (restorationImage.current && restorationImage.current !== selectedImage?.id)) return;
    restorationImage.current = null;
    setAnalysis(null);
    setOverlay("");
    setHistory([]);
    if (!token || !selectedImage) return;
    let active = true;
    let objectUrl = "";
    request<{ models_ready: boolean }>("/api/analysis/status", token)
      .then((status) => { if (active) setModelsReady(status.models_ready); })
      .catch(() => { if (active) setModelsReady(false); });
    if (pinnedRun.current?.imageId !== selectedImage.id) pinnedRun.current = null;
    const pin = pinnedRun.current;
    const sequence = ++overlayRequest.current;
    request<AnalysisResult[]>(`/api/images/${selectedImage.id}/analyses`, token)
      .then(async (items) => {
        if (!active) return;
        setHistory(items);
        if (sequence !== overlayRequest.current) return;
        const result = pinnedRunForImage(items, selectedImage.id, pin);
        if (!result) {
          if (pin) setError("The requested saved run is unavailable. Select a run from analysis history.");
          return;
        }
        setAnalysis(result);
        const response = await fetch(apiUrl(result.overlay_url), { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) { if (active && sequence === overlayRequest.current) setOverlay(""); return; }
        objectUrl = URL.createObjectURL(await response.blob());
        if (active && sequence === overlayRequest.current) setOverlay(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => { if (active && sequence === overlayRequest.current) { setAnalysis(null); setOverlay(""); } });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selectedImage?.id, selectedImage?.latest_analysis_id, token]);

  // Mirror the open saved run into the address bar so it can be bookmarked and shared.
  useEffect(() => {
    if (activeView !== "analysis" || !selected || caseListToken !== token) return;
    if (!selected.images.length) {
      const volumeLink = `${window.location.pathname}?case_id=${encodeURIComponent(selected.id)}`;
      if (volumeLink !== window.location.pathname + window.location.search) navigate(volumeLink, { replace: true });
      return;
    }
    if (!selectedImage || !selectedAnalysis) return;
    const next = analysisLocation(window.location.href, selected.id, selectedImage.id, selectedAnalysis.id);
    if (next !== window.location.pathname + window.location.search + window.location.hash) navigate(next, { replace: true });
  }, [activeView, selected?.id, selectedImage?.id, selectedAnalysis?.id, caseListToken, token]);

  async function showAnalysis(result: AnalysisResult) {
    if (selectedImageRef.current !== result.image_id) return;
    pinnedRun.current = { imageId: result.image_id, runId: result.id };
    const sequence = ++overlayRequest.current;
    setAnalysis(result);
    setOverlay((previous) => { if (previous) URL.revokeObjectURL(previous); return ""; });
    setError("");
    try {
      const response = await fetch(apiUrl(result.overlay_url), { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Analysis overlay unavailable");
      const objectUrl = URL.createObjectURL(await response.blob());
      if (selectedImageRef.current !== result.image_id || sequence !== overlayRequest.current) { URL.revokeObjectURL(objectUrl); return; }
      setOverlay((previous) => { if (previous) URL.revokeObjectURL(previous); return objectUrl; });
    } catch (cause) { setError((cause as Error).message); }
  }

  async function handleAnalysis() {
    if (!selectedImage || analysisBusy) return;
    pinnedRun.current = null;
    const submittedImageId = selectedImage.id;
    setError("");
    setAnalysisBusy(true);
    setAnalysisJob(null);
    try {
      const storageKey = `corovision-job-${selectedImage.id}`;
      const key = sessionStorage.getItem(storageKey) || crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
      const job = await request<AnalysisJob>(`/api/images/${selectedImage.id}/analysis/jobs`, token, { idempotency_key: key }, "POST");
      sessionStorage.removeItem(storageKey);
      if (selectedImageRef.current === submittedImageId) { announcedJobRef.current = job.id; setAnalysisJob(job); toast.info("Analysis queued. Results appear here when the run completes."); }
    } catch (cause) {
      setError((cause as Error).message);
      setAnalysisBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    setAnalysisJob(null);
    setAnalysisBusy(false);
    if (selectedImage && token) request<AnalysisJob[]>(`/api/images/${selectedImage.id}/analysis/jobs`, token)
      .then((jobs) => { if (active) setAnalysisJob(jobs.find((job) => ["pending", "processing"].includes(job.status)) || jobs[0] || null); })
      .catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [selectedImage?.id, token]);

  useEffect(() => {
    if (!analysisJob || analysisJob.image_id !== selectedImage?.id || !token) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const jobId = analysisJob.id;
    setAnalysisBusy(true);
    async function poll() {
      try {
        const job = await request<AnalysisJob>(`/api/analysis/jobs/${jobId}`, token);
        if (!active) return;
        setAnalysisJob(job);
        if (job.status === "failed") {
          setError(job.error_detail || "Analysis job failed; review before requesting a new run.");
          if (announcedJobRef.current === jobId) { announcedJobRef.current = null; toast.error("Analysis run failed. See the message on this page."); }
          setAnalysisBusy(false);
        } else if (job.status === "completed" && job.result_url) {
          const result = await request<AnalysisResult>(job.result_url, token);
          if (!active) return;
          await showAnalysis(result);
          const items = await request<AnalysisResult[]>(`/api/images/${job.image_id}/analyses`, token);
          if (!active) return;
          setHistory(items);
          await loadCases(token);
          if (!active) return;
          if (announcedJobRef.current === jobId) { announcedJobRef.current = null; setNotice("Research analysis saved. Review masks, candidate evidence and limitations."); }
          setAnalysisBusy(false);
        } else timer = setTimeout(poll, JOB_POLL_MS);
      } catch (cause) {
        if (active) { setError((cause as Error).message); setAnalysisBusy(false); }
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [analysisJob?.id, selectedImage?.id, token]);

  function clearSelectionResults() {
    setAnalysis(null);
    setOverlay("");
  }

  const imageHistory = history.filter((run) => run.image_id === selectedImage?.id);
  const imageAnalysis = analysis?.image_id === selectedImage?.id ? analysis : null;

  return {
    selectedImageId, setSelectedImageId, selectedImage, selectedAnalysis, imageAnalysis, imageHistory,
    preview, previewOwner, analysis, history, overlay, modelsReady, analysisBusy, analysisJob,
    showAnalysis, handleAnalysis, clearSelectionResults,
  };
}

export type AnalysisSession = ReturnType<typeof useAnalysisSession>;
