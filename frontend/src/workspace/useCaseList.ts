import { useEffect, useRef, useState } from "react";
import { request } from "../api";
import type { User } from "../AccountPanel";
import type { CaseRecord } from "../caseTypes";
import { canReadCases } from "../permissions";

const CASES_PER_PAGE = 8;
const CASE_REFRESH_MS = 2500;

export type CaseSort = "newest" | "oldest" | "code";

export function useCaseList(token: string, user: User) {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [caseListToken, setCaseListToken] = useState("");
  const [caseSearch, setCaseSearch] = useState("");
  const [caseStatus, setCaseStatus] = useState("all");
  const [caseModality, setCaseModality] = useState("all");
  const [caseTaskFilter, setCaseTaskFilter] = useState("all");
  const [caseSort, setCaseSort] = useState<CaseSort>("newest");
  const [casePage, setCasePage] = useState(1);
  const caseFetchSeq = useRef(0);
  const activeTokenRef = useRef(token);
  activeTokenRef.current = token;

  async function loadCases(activeToken: string) {
    const requestId = ++caseFetchSeq.current;
    const next = await request<CaseRecord[]>("/api/cases", activeToken);
    if (requestId !== caseFetchSeq.current || activeToken !== activeTokenRef.current) return;
    setCases((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    setCaseListToken(activeToken);
    setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id || "");
  }

  // Initial load for this session.
  useEffect(() => {
    if (canReadCases(user.role)) loadCases(token).catch(() => {});
  }, [token, user.role]);

  // Keep the list fresh while the tab is visible.
  useEffect(() => {
    if (!token || !canReadCases(user.role)) return;
    let inFlight = false;
    const refresh = () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      loadCases(token).catch(() => {}).finally(() => { inFlight = false; });
    };
    const timer = window.setInterval(refresh, CASE_REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [token, user.role]);

  const selected = cases.find((item) => item.id === selectedId);
  const matchingCases = cases.filter((item) =>
    (caseStatus === "all" || item.status === caseStatus) &&
    (caseModality === "all" || item.modality === caseModality) &&
    (caseTaskFilter === "all" || (item.intended_tasks || [item.intended_task]).includes(caseTaskFilter)) &&
    `${item.case_code} ${item.patient_code || ""} ${item.source_dataset || ""} ${item.anatomy}`.toLowerCase().includes(caseSearch.trim().toLowerCase())
  ).sort((left, right) => caseSort === "code" ? left.case_code.localeCompare(right.case_code)
    : caseSort === "oldest" ? left.created_at.localeCompare(right.created_at) : right.created_at.localeCompare(left.created_at));
  const pageCount = Math.max(1, Math.ceil(matchingCases.length / CASES_PER_PAGE));
  const currentPage = Math.min(casePage, pageCount);
  const visibleCases = matchingCases.slice((currentPage - 1) * CASES_PER_PAGE, currentPage * CASES_PER_PAGE);

  const replaceCase = (updated: CaseRecord) => setCases((items) => items.map((item) => item.id === updated.id ? updated : item));

  return {
    cases, setCases, replaceCase, selectedId, setSelectedId, selected, caseListToken, loadCases,
    caseSearch, setCaseSearch, caseStatus, setCaseStatus, caseModality, setCaseModality,
    caseTaskFilter, setCaseTaskFilter, caseSort, setCaseSort, casePage, setCasePage,
    matchingCases, visibleCases, pageCount, currentPage, casesPerPage: CASES_PER_PAGE,
  };
}

export type CaseList = ReturnType<typeof useCaseList>;
