import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ChevronLeft, ChevronRight, FileText, ScanLine } from "lucide-react";
import { apiUrl } from "../api";
import { analysisSummaryLabel, type CaseRecord } from "../caseTypes";
import { Button } from "../components/prismui/button";
import { Card } from "../components/prismui/card";
import { utcDate } from "../lib/time";
import VolumeReports from "../VolumeReports";

/** Case chooser for the Reports section: every case, 2D or 3D, is opened the same way. */
export function ReportsCasePicker({ cases, selectedId, onSelect }: { cases: CaseRecord[]; selectedId?: string; onSelect: (id: string) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const element = track.current;
    if (element) setEdge({ start: element.scrollLeft <= 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, cases.length]);
  useEffect(() => {
    track.current?.querySelector<HTMLElement>(".reports-case.is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId]);
  const slide = (direction: -1 | 1) => {
    const element = track.current;
    if (element) element.scrollBy({ left: direction * Math.max(240, element.clientWidth * 0.8), behavior: "smooth" });
  };
  if (!cases.length) return <Card className="panel"><p className="muted">No cases yet. Create a case and run an analysis to produce a report.</p></Card>;
  return <Card className="panel reports-picker">
    <div className="cv-panel-head reports-picker-head"><div><span className="eyebrow">CHOOSE A CASE</span><h3>Which case is this report for?</h3></div>
      <div className="reports-picker-nav" aria-label="Scroll cases">
        <span className="reports-picker-count">{cases.length} case{cases.length === 1 ? "" : "s"}</span>
        <button type="button" className="reports-picker-arrow" aria-label="Scroll cases left" disabled={edge.start} onClick={() => slide(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
        <button type="button" className="reports-picker-arrow" aria-label="Scroll cases right" disabled={edge.end} onClick={() => slide(1)}><ChevronRight size={18} aria-hidden="true" /></button>
      </div></div>
    <div className="reports-case-grid" role="list" ref={track} onScroll={measure} tabIndex={0} aria-label="Cases, scroll sideways">
      {cases.map(item => {
        const volume = !(item.modalities ?? [item.modality]).includes("XCA");
        const Icon = volume ? Box : ScanLine;
        const saved = item.analysis_summary?.reports_saved ?? 0;
        return <button key={item.id} type="button" role="listitem" className={`reports-case${item.id === selectedId ? " is-active" : ""}`} aria-pressed={item.id === selectedId} onClick={() => onSelect(item.id)}>
          <span className="reports-case-icon"><Icon size={18} aria-hidden="true" /></span>
          <span className="reports-case-main"><strong>{item.case_code}</strong><small>{item.modality} · {item.anatomy} · {volume ? "3D volume" : "2D image"}</small>
            <small>{analysisSummaryLabel(item.analysis_summary)}</small></span>
          <span className="reports-case-count"><FileText size={13} aria-hidden="true" /> {saved} report{saved === 1 ? "" : "s"}</span>
        </button>;
      })}
    </div>
  </Card>;
}

type Run = { id: string; status: string; created_at: string; model_key?: string; result?: { model_id?: string } };

/** Report builder for a 3D case: pick a saved run, preview the PDF, save a version, download exports. */
export function VolumeReportBuilder({ token, record, preferredRunId, onOpenAnalysis, onOpenUploads }: {
  token: string; record: CaseRecord; preferredRunId?: string | null; onOpenAnalysis: () => void; onOpenUploads: () => void;
}) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [runId, setRunId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setRuns(null); setRunId(""); setError("");
    fetch(apiUrl(`/api/cases/${record.id}/volumes/analyses`), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Saved 3D runs could not be loaded.");
        const data = await response.json();
        const list: Run[] = (Array.isArray(data) ? data : data.runs ?? []).filter((run: Run) => run.status === "completed");
        setRuns(list);
        setRunId(list.find(run => run.id === preferredRunId)?.id ?? list[0]?.id ?? "");
      }).catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message); });
    return () => controller.abort();
  }, [record.id, token, preferredRunId]);

  const run = runs?.find(item => item.id === runId);
  return <section className="reports-page reports-builder" aria-label="3D report builder">
    <div className="page-heading"><div><p className="eyebrow">DOCUMENT · SAVED 3D ANALYSIS</p><h2>Research Reports</h2>
      <p className="muted">One volume, one saved run, an immutable report version.</p></div><span className="stage-badge">Research only · not clinical</span></div>
    {error && <p className="message error" role="alert">{error}</p>}
    {runs === null && !error && <p role="status">Loading saved runs…</p>}
    {runs !== null && runs.length === 0 && <Card className="panel"><p className="muted">This case has no completed 3D analysis yet, so there is nothing to report on.</p>
      <div className="cv-actions"><Button onClick={onOpenUploads}>Upload a volume</Button></div></Card>}
    {runs !== null && runs.length > 0 && <>
      <Card className="panel">
        <div className="workbench-selectors">
          <label>Saved analysis run<select value={runId} onChange={event => setRunId(event.target.value)}>
            {runs.map(item => <option key={item.id} value={item.id}>{utcDate(item.created_at).toLocaleString()} · {item.id.slice(0, 8)}</option>)}</select></label>
        </div>
        {run && <p className="caption">Model {run.result?.model_id ?? run.model_key ?? "unavailable"} · {run.status}. The report repeats this saved run exactly; it never re-runs the model.</p>}
        <div className="cv-actions"><Button variant="outline" onClick={onOpenAnalysis}>Open the full analysis</Button></div>
      </Card>
      {runId && <VolumeReports key={runId} endpoint={`/api/cases/${record.id}/volumes/analyses/${runId}`} token={token} runId={runId} caseId={record.id} />}
    </>}
  </section>;
}
