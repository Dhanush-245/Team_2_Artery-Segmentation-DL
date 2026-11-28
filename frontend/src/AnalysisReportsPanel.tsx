import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Save } from "lucide-react";
import { apiUrl, request } from "./api";
import type { AnalysisResult, CaseRecord } from "./caseTypes";
import { Card } from "./components/prismui/card";
import { canExportReports } from "./permissions";
import { toast } from "./lib/toast";
import { utcDate } from "./lib/time";

type ReportIndex = { id: string; version: number; image_id: string; analysis_event_id: string; created_at: string };
const FORMATS = [["pdf", "PDF"], ["json", "JSON"], ["csv", "CSV"], ["zip", "Evidence ZIP"]] as const;
const DEFAULT_SECTIONS = ["images", "measurements", "candidates", "review"];

/** Reports & exports block of the 2D case page: save a version of this run and download it without leaving the page. */
export default function AnalysisReportsPanel({ token, role, selectedCase, imageId, analysis, onOpenFull }: {
  token: string; role: string; selectedCase?: CaseRecord; imageId: string; analysis: AnalysisResult; onOpenFull: () => void;
}) {
  const [reports, setReports] = useState<ReportIndex[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const allowed = !!selectedCase?.permissions?.can_export && canExportReports(role);
  const caseId = selectedCase?.id;

  const load = useCallback(async () => {
    if (!caseId || !allowed) return;
    try { setReports(await request<ReportIndex[]>(`/api/cases/${caseId}/research-reports`, token)); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, [caseId, token, allowed]);
  useEffect(() => { setReports([]); void load(); }, [load, analysis.id]);

  const forRun = reports.filter(item => item.analysis_event_id === analysis.id);

  async function generate() {
    if (!caseId) return;
    setBusy("generate"); setError("");
    try {
      const saved = await request<{ version: number }>(`/api/cases/${caseId}/research-reports`, token,
        { image_id: imageId, analysis_event_id: analysis.id, sections: DEFAULT_SECTIONS }, "POST");
      toast.success(`Research report v${saved.version} saved.`);
      await load();
    } catch (cause) { setError((cause as Error).message); toast.error("Report could not be saved."); }
    finally { setBusy(""); }
  }

  async function download(report: ReportIndex, format: string) {
    if (!caseId) return;
    setBusy(`${report.id}:${format}`); setError("");
    try {
      const response = await fetch(apiUrl(`/api/cases/${caseId}/research-reports/${report.id}/export/${format}`), { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload?.detail === "string" ? payload.detail : `Export failed (${response.status})`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(selectedCase?.case_code || "case").replace(/[^a-z0-9_-]/gi, "_")}-research-v${report.version}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${format === "zip" ? "Evidence ZIP" : format.toUpperCase()} downloaded.`);
    } catch (cause) { setError((cause as Error).message); toast.error(`${format.toUpperCase()} export failed.`); }
    finally { setBusy(""); }
  }

  return <Card className="panel analysis-reports" id="xca-reports">
    <div className="viewer-heading"><h3>Reports &amp; exports</h3><span>{forRun.length} saved for this run</span></div>
    {!allowed ? <p className="muted">Your role or this case's sharing does not include report export. Ask the case owner for export access.</p> : <>
      <p className="caption">Each saved report is an immutable research version of this run. Exports repeat that saved content exactly.</p>
      <div className="analysis-reports-actions">
        <button type="button" className="cv-outline-button" disabled={!!busy} onClick={generate}><Save size={16} aria-hidden="true" /> {busy === "generate" ? "Saving…" : "Save new report version"}</button>
        <button type="button" className="cv-outline-button" onClick={onOpenFull}><FileText size={16} aria-hidden="true" /> Open full report page</button>
      </div>
      {forRun.length === 0 ? <p className="muted">No report has been saved for this run yet. Save one to enable downloads.</p> : <ul className="analysis-report-list">
        {forRun.map(item => <li key={item.id}>
          <div><strong>Version {item.version}</strong><small>{utcDate(item.created_at).toLocaleString()}</small></div>
          <div className="analysis-report-downloads">{FORMATS.map(([format, label]) =>
            <button type="button" className="cv-outline-button" key={format} disabled={!!busy} onClick={() => download(item, format)}>
              <Download size={14} aria-hidden="true" /> {busy === `${item.id}:${format}` ? "Preparing…" : label}</button>)}</div>
        </li>)}
      </ul>}
      {error && <p className="message error" role="alert">{error}</p>}
    </>}
  </Card>;
}
