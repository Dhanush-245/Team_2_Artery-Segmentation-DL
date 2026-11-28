import { useCallback, useEffect, useState } from "react";
import { request } from "./api";
import { Card } from "./components/prismui/card";
import { formatBytes, memoryStatus, overallLevel, type OpsAlerts, type OpsEvent, type OpsLevel, type OpsSnapshot } from "./lib/operations";
import { utcDate } from "./lib/time";

function Spark({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return <div className="ops-spark ops-spark-empty">Collecting data…</div>;
  const max = Math.max(...values, 1), min = Math.min(...values, 0), span = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${34 - ((value - min) / span) * 30}`);
  return <svg className={`ops-spark tone-${tone}`} viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label={`Trend over ${values.length} checks`}>
    <polygon points={`0,36 ${points.join(" ")} 100,36`} /><polyline points={points.join(" ")} /></svg>;
}

function Gauge({ percent, label, detail, bad }: { percent: number; label: string; detail: string; bad?: boolean }) {
  const value = Math.max(0, Math.min(100, percent));
  return <div className="ops-gauge"><div className={`ops-ring${bad ? " bad" : ""}`} style={{ ["--p" as string]: `${value * 3.6}deg` }}><b>{Math.round(value)}%</b></div>
    <div><strong>{label}</strong><small>{detail}</small></div></div>;
}

type RouteRow = { method: string; route: string; status_class: number; requests: number; errors: number; seconds: number; max_seconds: number };
type OpsLive = { uptime_seconds: number; routes: RouteRow[]; analysis_jobs: Record<string, number> };
const RANGES = [["1", "1 h"], ["6", "6 h"], ["24", "24 h"]] as const;
const LEVEL_FILTERS: (OpsLevel | "all")[] = ["all", "info", "warning", "error", "critical"];

export default function OperationsPanel({ token }: { token: string }) {
  const [alerts, setAlerts] = useState<OpsAlerts | null>(null);
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [history, setHistory] = useState<OpsSnapshot[]>([]);
  const [level, setLevel] = useState<OpsLevel | "all">("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState("24");
  const [auto, setAuto] = useState(true);
  const [live, setLive] = useState<OpsLive | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"requests" | "slow" | "errors">("requests");
  const [updated, setUpdated] = useState<Date | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const query = level === "all" ? "" : `&level=${level}`;
      const [nextAlerts, nextEvents, nextHistory, nextLive] = await Promise.all([
        request<OpsAlerts>("/api/admin/operations/alerts", token),
        request<{ events: OpsEvent[] }>(`/api/admin/operations/events?limit=100${query}`, token),
        request<{ snapshots: OpsSnapshot[] }>(`/api/admin/operations/history?hours=${hours}`, token),
        request<OpsLive>("/api/admin/operations", token),
      ]);
      setAlerts(nextAlerts); setCounts(nextAlerts.recent_alerts.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.level]: (acc[item.level] ?? 0) + 1 }), {})); setEvents(nextEvents.events); setHistory(nextHistory.snapshots.slice(-96)); setLive(nextLive); setUpdated(new Date()); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, [token, level, hours]);

  useEffect(() => {
    void load();
    if (!auto) return undefined;
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, [load, auto]);

  function exportEvents() {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["time", "level", "event", "message", "reference"], ...shownEvents.map((row) => [row.created_at, row.level, row.kind, row.message, row.details.request_id ?? row.details.route ?? ""])];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(quote).join(",")).join("\n")], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = "corovision-operations-events.csv"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
  const perCheck = history.map((row, index) => { const before = history[index - 1]?.requests ?? 0; return row.requests >= before ? row.requests - before : row.requests; });
  const memorySeries = history.map((row) => row.memory_percent ?? 0);
  const storageUsed = signals ? ((signals.storage.total_bytes - signals.storage.free_bytes) / Math.max(signals.storage.total_bytes, 1)) * 100 : 0;
  const memoryPercent = signals?.memory.percent ?? 0;
  const lastRun = alerts?.monitor.last_run ? utcDate(alerts.monitor.last_run).toLocaleTimeString() : "";
  const needle = search.trim().toLowerCase();
  const shownEvents = needle ? events.filter((row) => `${row.kind} ${row.message} ${String(row.details.request_id ?? row.details.route ?? "")}`.toLowerCase().includes(needle)) : events;
  const routeTable = Object.values((live?.routes ?? []).reduce<Record<string, { key: string; requests: number; errors: number; seconds: number; max: number }>>((acc, row) => {
    const key = `${row.method} ${row.route}`;
    const item = acc[key] ?? { key, requests: 0, errors: 0, seconds: 0, max: 0 };
    item.requests += row.requests; item.errors += row.errors; item.seconds += row.seconds; item.max = Math.max(item.max, row.max_seconds);
    acc[key] = item; return acc;
  }, {})).sort((a, b) => sortBy === "slow" ? b.seconds / b.requests - a.seconds / a.requests : sortBy === "errors" ? b.errors - a.errors || b.requests - a.requests : b.requests - a.requests).slice(0, 8);
  const totalRequests = (live?.routes ?? []).reduce((sum, row) => sum + row.requests, 0);
  const uptime = live ? (live.uptime_seconds >= 3600 ? `${Math.floor(live.uptime_seconds / 3600)} h ${Math.floor((live.uptime_seconds % 3600) / 60)} min` : `${Math.max(1, Math.floor(live.uptime_seconds / 60))} min`) : "";
  const jobs = live?.analysis_jobs ?? {};
  const upChecks = history.filter((row) => row.ready).length;

  return <div className="settings-page operations-page">
    <section className={`ops-hero level-${status}`}>
      <div><p className="eyebrow">OPERATIONS</p><h2>Monitoring &amp; alerts</h2>
        <p>{status === "info" ? "Every service check is passing. Nothing needs attention." : `${alerts?.conditions_now.length} alert${alerts?.conditions_now.length === 1 ? "" : "s"} firing now. Review them below.`}</p></div>
      <div className="ops-hero-side"><span className={`ops-badge level-${status}`}>{status === "info" ? "All clear" : `${status} alert firing`}</span>
        <small>{alerts?.monitor.running ? `Background monitor running${lastRun ? ` · last check ${lastRun}` : ""}` : alerts?.monitor.enabled ? "Monitor starting" : "Monitor off (set OPS_MONITOR=1)"}</small>
        <div className="ops-controls"><label className="ops-toggle"><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} /> Auto-refresh (30 s)</label>
          <button type="button" className="cv-outline-button" onClick={() => void load()}>Refresh</button></div>
        {updated && <small>Updated {updated.toLocaleTimeString()}</small>}</div>
    </section>
    <p className="muted">Central operational log and automatic alerts. Entries hold counts, route names and request ids only, never patient data or tokens.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="message success">{notice}</p>}
    {!alerts && !error && <p role="status">Loading operations data…</p>}
    {alerts && signals && <>
      <h3 className="ops-section-title">Current signals</h3>
      <div className="ops-kpis">
        <Card className="ops-kpi"><span>Readiness</span><strong className={signals.ready ? "ops-good" : "ops-bad"}>{signals.ready ? "Ready" : "Not ready"}</strong><small>{history.length ? `${upChecks} of ${history.length} checks ready (24 h)` : "No history yet"}</small></Card>
        <Card className="ops-kpi"><span>Requests per check</span><strong>{perCheck.length ? perCheck[perCheck.length - 1] : 0}</strong><Spark values={perCheck} tone="blue" /></Card>
        <Card className="ops-kpi"><span>Server errors (recent)</span><strong className={signals.server_errors ? "ops-bad" : "ops-good"}>{signals.server_errors}</strong><small>{signals.server_errors ? "Check the event log" : "None in the recent window"}</small></Card>
        <Card className="ops-kpi"><span>Failed analyses (recent)</span><strong className={signals.failed_jobs ? "ops-bad" : "ops-good"}>{signals.failed_jobs}</strong><small>{signals.failed_jobs ? "Open AI Analysis jobs" : "All analysis jobs healthy"}</small></Card>
      </div>
      <div className="ops-two">
        <Card className="panel"><h3>Resources</h3>
          <div className="ops-gauges">
            <Gauge percent={memoryPercent} label="Memory" detail={memoryStatus(signals.memory, warnPercent).label} bad={memoryPercent >= warnPercent} />
            <Gauge percent={storageUsed} label="Storage used" detail={`${formatBytes(signals.storage.free_bytes)} free of ${formatBytes(signals.storage.total_bytes)}`} bad={storageUsed >= 90} />
          </div>
          <p className="caption">Memory trend, last {history.length || 0} checks</p><Spark values={memorySeries} tone="violet" />
        </Card>
        <Card className="panel"><h3>Alert channels</h3>
          <ul className="ops-channel-cards">
            <li><b className="ops-dot on" /><div><strong>In-app bell</strong><small>Every active administrator is notified.</small></div><span className="ops-badge">On</span></li>
            <li><b className={`ops-dot${alerts.channels.webhook ? " on" : ""}`} /><div><strong>Webhook</strong><small>{alerts.channels.webhook ? "Slack, Discord, Teams or pager connected." : "Set OPS_ALERT_WEBHOOK_URL in the service variables."}</small></div><span className="ops-badge">{alerts.channels.webhook ? "Configured" : "Not configured"}</span></li>
          </ul>
          <button type="button" className="cv-outline-button" disabled={busy} onClick={() => void sendTest()}>{busy ? "Sending…" : "Send a test alert"}</button>
          {alerts.conditions_now.length > 0 && <ul className="ops-conditions" aria-label="Alerts firing now">{alerts.conditions_now.map((item) => <li key={item.name} className={`level-${item.level}`}><strong>{item.level}</strong> {item.message}</li>)}</ul>}
          <details className="ops-settings"><summary>Thresholds (change with OPS_* variables)</summary>
            <table><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>{Object.entries(alerts.settings).map(([key, value]) => <tr key={key}><td>{key.replaceAll("_", " ")}</td><td>{String(value)}</td></tr>)}</tbody></table>
          </details>
        </Card>
      </div>
      <div className="ops-two">
        <Card className="panel"><div className="viewer-heading"><h3>Live API traffic</h3><span>Up {uptime} · {totalRequests} requests</span></div>
          <div className="ops-job-pills" aria-label="Analysis jobs">{["pending", "running", "completed", "failed"].map((state) => <span key={state} className={`ops-pill state-${state}`}>{state} <b>{jobs[state] ?? 0}</b></span>)}</div>
          <div className="ops-chips" role="group" aria-label="Sort routes">{([["requests", "Busiest"], ["slow", "Slowest"], ["errors", "Most errors"]] as const).map(([key, label]) => <button type="button" key={key} className={`ops-chip${sortBy === key ? " active" : ""}`} aria-pressed={sortBy === key} onClick={() => setSortBy(key)}>{label}</button>)}</div>
          {routeTable.length ? <div className="table-scroll"><table><thead><tr><th>Route</th><th>Requests</th><th>Errors</th><th>Mean</th><th>Max</th></tr></thead>
            <tbody>{routeTable.map((row) => <tr key={row.key}><td><code>{row.key}</code></td><td>{row.requests}</td><td className={row.errors ? "ops-bad" : ""}>{row.errors}</td><td>{Math.round((row.seconds / row.requests) * 1000)} ms</td><td>{Math.round(row.max * 1000)} ms</td></tr>)}</tbody></table></div>
            : <p className="muted">No requests recorded since the service started.</p>}
          <p className="caption">Counted by this API process since it started; resets on restart.</p>
        </Card>
        <Card className="panel"><div className="viewer-heading"><h3>Trends</h3>
          <div className="ops-chips" role="group" aria-label="Time range">{RANGES.map(([value, label]) => <button type="button" key={value} className={`ops-chip${hours === value ? " active" : ""}`} aria-pressed={hours === value} onClick={() => setHours(value)}>{label}</button>)}</div></div>
          <p className="caption">Requests per check</p><Spark values={perCheck} tone="blue" />
          <p className="caption">Server errors per check</p><Spark values={history.map((row) => row.server_errors)} tone="red" />
          <p className="caption">Free storage (MB)</p><Spark values={history.map((row) => row.storage_free_mb)} tone="green" />
        </Card>
      </div>
      <Card className="panel"><h3>Metric history (last {hours} h)</h3>
        {history.length ? <details className="ops-settings" open><summary>Show the latest 12 snapshots</summary><div className="table-scroll"><table><thead><tr><th>Time</th><th>Requests</th><th>Server errors</th><th>Memory</th><th>Free storage</th><th>Ready</th></tr></thead>
          <tbody>{[...history].reverse().slice(0, 12).map((row) => <tr key={row.at}><td>{utcDate(row.at).toLocaleString()}</td><td>{row.requests}</td><td>{row.server_errors}</td><td>{row.memory_percent === null ? `${row.memory_used_mb} MB` : `${row.memory_percent}%`}</td><td>{row.storage_free_mb} MB</td><td>{row.ready ? "Yes" : "No"}</td></tr>)}</tbody></table></div></details>
          : <p className="muted">No snapshots yet. The monitor saves one every few minutes while it is running.</p>}
      </Card>
      <Card className="panel"><div className="viewer-heading"><h3>Event log</h3><span>{shownEvents.length} shown</span></div>
        <div className="ops-tools"><input type="search" className="ops-search" placeholder="Search events, messages or request ids" aria-label="Search events" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button type="button" className="cv-outline-button" disabled={!shownEvents.length} onClick={exportEvents}>Download events (CSV)</button></div>
        <div className="ops-chips" role="group" aria-label="Filter by level">{LEVEL_FILTERS.map((item) => <button type="button" key={item} className={`ops-chip${level === item ? " active" : ""}`} aria-pressed={level === item} onClick={() => setLevel(item)}>{item}{item !== "all" && counts[item] ? ` · ${counts[item]}` : ""}</button>)}</div>
        {shownEvents.length ? <ol className="ops-feed">{shownEvents.map((row) => <li key={row.id} className={`level-${row.level}`}><b className="ops-dot" /><div><div><span className={`ops-badge level-${row.level}`}>{row.level}</span> <strong>{row.kind}</strong></div><p>{row.message}</p>{!!(row.details.request_id ?? row.details.route) && <small>{String(row.details.request_id ?? row.details.route)}</small>}</div><time>{utcDate(row.created_at).toLocaleString()}</time></li>)}</ol>
          : <p className="muted">No events match.</p>}
        <p className="caption">Kept for 30 days, newest 5,000 entries. Use the request id from an error response to find its entry.</p>
      </Card>
    </>}
  </div>;
}
