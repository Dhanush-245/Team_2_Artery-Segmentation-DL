import { useCallback, useEffect, useState } from "react";
import { request } from "./api";
import { Card } from "./components/prismui/card";
import { formatBytes, memoryStatus, overallLevel, type OpsAlerts, type OpsEvent, type OpsLevel, type OpsSnapshot } from "./lib/operations";
import { utcDate } from "./lib/time";

const LEVEL_FILTERS: (OpsLevel | "all")[] = ["all", "info", "warning", "error", "critical"];

export default function OperationsPanel({ token }: { token: string }) {
  const [alerts, setAlerts] = useState<OpsAlerts | null>(null);
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [history, setHistory] = useState<OpsSnapshot[]>([]);
  const [level, setLevel] = useState<OpsLevel | "all">("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = level === "all" ? "" : `&level=${level}`;
      const [nextAlerts, nextEvents, nextHistory] = await Promise.all([
        request<OpsAlerts>("/api/admin/operations/alerts", token),
        request<{ events: OpsEvent[] }>(`/api/admin/operations/events?limit=100${query}`, token),
        request<{ snapshots: OpsSnapshot[] }>("/api/admin/operations/history?hours=24", token),
      ]);
      setAlerts(nextAlerts); setEvents(nextEvents.events); setHistory(nextHistory.snapshots.slice(-12).reverse()); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, [token, level]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function sendTest() {
    setBusy(true); setNotice(""); setError("");
    try {
      const result = await request<{ admins_notified: number; webhook: string }>("/api/admin/operations/test-alert", token, {}, "POST");
      const webhook = result.webhook === "sent" ? "and the webhook" : result.webhook === "failed" ? "but the webhook could not be reached" : "(no webhook configured)";
      setNotice(`Test alert sent to ${result.admins_notified} administrator${result.admins_notified === 1 ? "" : "s"} ${webhook}.`);
      window.dispatchEvent(new Event("corovision:notifications-changed"));
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  const signals = alerts?.signals;
  const status = alerts ? overallLevel(alerts.conditions_now) : "info";
  const warnPercent = Number(alerts?.settings.memory_warn_percent ?? 85);

  return <div className="settings-page operations-page">
    <div className="page-heading"><div><p className="eyebrow">OPERATIONS</p><h2>Monitoring &amp; alerts</h2></div>
      <span className={`ops-badge level-${status}`}>{status === "info" ? "All clear" : `${status} alert firing`}</span></div>
    <p className="muted">Central operational log and automatic alerts. Entries hold counts, route names and request ids only, never patient data or tokens.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="message success">{notice}</p>}
    {!alerts && !error && <p role="status">Loading operations data…</p>}
    {alerts && signals && <>
      <Card className="panel"><div className="viewer-heading"><h3>Current signals</h3><button type="button" className="cv-outline-button" onClick={() => void load()}>Refresh</button></div>
        <div className="ops-signals">
          <div><span>Readiness</span><strong className={signals.ready ? "" : "ops-bad"}>{signals.ready ? "Ready" : "Not ready"}</strong></div>
          <div><span>Memory</span><strong className={memoryStatus(signals.memory, warnPercent).level === "info" ? "" : "ops-bad"}>{memoryStatus(signals.memory, warnPercent).label}</strong></div>
          <div><span>Free storage</span><strong>{formatBytes(signals.storage.free_bytes)} of {formatBytes(signals.storage.total_bytes)}</strong></div>
          <div><span>Server errors (recent window)</span><strong>{signals.server_errors}</strong></div>
          <div><span>Failed analyses (recent window)</span><strong>{signals.failed_jobs}</strong></div>
          <div><span>Background monitor</span><strong>{alerts.monitor.running ? `Running${alerts.monitor.last_run ? `, last check ${utcDate(alerts.monitor.last_run).toLocaleTimeString()}` : ""}` : alerts.monitor.enabled ? "Starting" : "Off (set OPS_MONITOR=1)"}</strong></div>
        </div>
        {alerts.conditions_now.length > 0 && <ul className="ops-conditions" aria-label="Alerts firing now">{alerts.conditions_now.map((item) => <li key={item.name} className={`level-${item.level}`}><strong>{item.level}</strong> {item.message}</li>)}</ul>}
      </Card>
      <Card className="panel"><h3>Alert channels</h3>
        <ul className="ops-channels">
          <li>In-app: every active administrator gets a notification in the bell. <strong>On</strong></li>
          <li>Webhook (Slack, Discord, Teams or a pager): {alerts.channels.webhook ? <strong>Configured</strong> : <strong>Not configured</strong>}. {alerts.channels.webhook ? "" : "Set OPS_ALERT_WEBHOOK_URL in the service variables."}</li>
        </ul>
        <button type="button" className="cv-outline-button" disabled={busy} onClick={() => void sendTest()}>{busy ? "Sending…" : "Send a test alert"}</button>
        <details className="ops-settings"><summary>Thresholds (change with OPS_* variables)</summary>
          <table><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>{Object.entries(alerts.settings).map(([key, value]) => <tr key={key}><td>{key.replaceAll("_", " ")}</td><td>{String(value)}</td></tr>)}</tbody></table>
        </details>
      </Card>
      <Card className="panel"><h3>Metric history (last 24 hours)</h3>
        {history.length ? <div className="table-scroll"><table><thead><tr><th>Time</th><th>Requests</th><th>Server errors</th><th>Memory</th><th>Free storage</th><th>Ready</th></tr></thead>
          <tbody>{history.map((row) => <tr key={row.at}><td>{utcDate(row.at).toLocaleString()}</td><td>{row.requests}</td><td>{row.server_errors}</td><td>{row.memory_percent === null ? `${row.memory_used_mb} MB` : `${row.memory_percent}%`}</td><td>{row.storage_free_mb} MB</td><td>{row.ready ? "Yes" : "No"}</td></tr>)}</tbody></table></div>
          : <p className="muted">No snapshots yet. The monitor saves one every few minutes while it is running.</p>}
      </Card>
      <Card className="panel"><div className="viewer-heading"><h3>Event log</h3>
        <label>Level <select value={level} onChange={(event) => setLevel(event.target.value as OpsLevel | "all")}>{LEVEL_FILTERS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div>
        {events.length ? <div className="table-scroll"><table><thead><tr><th>Time</th><th>Level</th><th>Event</th><th>Message</th><th>Reference</th></tr></thead>
          <tbody>{events.map((row) => <tr key={row.id}><td>{utcDate(row.created_at).toLocaleString()}</td><td><span className={`ops-badge level-${row.level}`}>{row.level}</span></td><td>{row.kind}</td><td>{row.message}</td><td><small>{String(row.details.request_id ?? row.details.route ?? "")}</small></td></tr>)}</tbody></table></div>
          : <p className="muted">No events at this level.</p>}
        <p className="caption">Kept for 30 days, newest 5,000 entries. Use the request id from an error response to find its entry.</p>
      </Card>
    </>}
  </div>;
}
