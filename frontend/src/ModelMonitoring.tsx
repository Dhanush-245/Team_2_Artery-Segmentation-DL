import { useEffect, useState } from "react";
import { request } from "./api";
import type { ModelRegistry, ModelStatus } from "./ModelWorkspace";

type RouteRow = { method: string; route: string; status_class: number; requests: number; errors: number; seconds: number; max_seconds: number };
type Operations = { uptime_seconds: number; routes: RouteRow[]; analysis_jobs: Record<string, number>; storage_free_bytes: number; scope: string };
type OpsEvent = { id?: string; created_at: string; level: string; kind: string; message: string };
type Snapshot = { at: string; memory_percent?: number; memory_used_mb?: number; failed_jobs_recent?: number };

const ms = (seconds: number) => `${(seconds * 1000).toFixed(0)} ms`;
const uptime = (seconds: number) => seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`;
const INFERENCE_ROUTE = /analy|inference|segment/i;

function summarize(rows: RouteRow[]) {
  const requests = rows.reduce((sum, row) => sum + row.requests, 0);
  const seconds = rows.reduce((sum, row) => sum + row.seconds, 0);
  return { requests, errors: rows.reduce((sum, row) => sum + row.errors, 0), mean: requests ? seconds / requests : 0, slowest: Math.max(0, ...rows.map(row => row.max_seconds)) };
}

/** Monitoring view: connects the model page to the service telemetry the API already records (administrators only). */
export default function ModelMonitoring({ token, role, status, registry }: { token: string; role: string; status: ModelStatus; registry: ModelRegistry | null }) {
  const [ops, setOps] = useState<Operations | null>(null);
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const admin = role === "admin";

  useEffect(() => {
    if (!admin) return;
    let active = true;
    Promise.all([
      request<Operations>("/api/admin/operations", token),
      request<{ events: OpsEvent[] }>("/api/admin/operations/events?limit=200", token),
      request<{ snapshots: Snapshot[] }>("/api/admin/operations/history?hours=24", token),
    ]).then(([operations, log, history]) => {
      if (!active) return;
      setOps(operations); setEvents(log.events); setSnapshot(history.snapshots.at(-1) ?? null); setError("");
    }).catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [token, admin]);

  const all = summarize(ops?.routes ?? []);
  const inference = summarize((ops?.routes ?? []).filter(row => INFERENCE_ROUTE.test(row.route) && row.method === "POST"));
  const serviceEvents = events.filter(item => item.kind === "service_started" || item.kind === "service_stopping").slice(0, 8);
  const jobs = Object.entries(ops?.analysis_jobs ?? {});

  return <>
    <div className="cv-model-grid">
      <article className="cv-model-card"><h4>Inference snapshot</h4><dl className="cv-model-status"><dt>Service model readiness</dt><dd>{status.models_ready ? "Ready" : "Unavailable"}</dd><dt>Active version</dt><dd>{status.model_version}</dd><dt>Release verification</dt><dd>{status.trained_release?.configured ? status.trained_release.ready ? "Verified and ready" : "Not ready" : "No release configured"}</dd><dt>Registered architectures</dt><dd>{registry ? registry.models.length : "Not available"}</dd></dl></article>
      <article className="cv-model-card"><h4>Live service telemetry</h4>
        {!admin ? <p>Service telemetry is visible to administrators only.</p> : error ? <p role="alert">Telemetry could not be loaded: {error}</p> : !ops ? <p>Loading telemetry…</p> : <>
          <dl className="cv-model-status">
            <dt>API uptime</dt><dd>{uptime(ops.uptime_seconds)}</dd>
            <dt>Requests · server errors</dt><dd>{all.requests} · {all.errors} ({all.requests ? ((all.errors / all.requests) * 100).toFixed(2) : "0.00"}%)</dd>
            <dt>Mean API latency</dt><dd>{all.requests ? ms(all.mean) : "No requests yet"}</dd>
            <dt>Analysis requests (POST)</dt><dd>{inference.requests ? `${inference.requests} · mean ${ms(inference.mean)} · slowest ${ms(inference.slowest)}` : "None since the API started"}</dd>
            <dt>Analysis jobs</dt><dd>{jobs.length ? jobs.map(([name, count]) => `${name}: ${count}`).join(" · ") : "None recorded"}</dd>
            <dt>Memory (latest snapshot)</dt><dd>{snapshot?.memory_percent != null ? `${snapshot.memory_percent}% · ${snapshot.memory_used_mb} MB` : "No snapshot yet"}</dd>
            <dt>Free storage</dt><dd>{(ops.storage_free_bytes / 1e9).toFixed(0)} GB</dd>
          </dl>
          <p className="caption">{ops.scope}. Latency covers the API process only, not model compute on a separate worker. GPU usage and data drift are not measured here. Epoch-by-epoch loss is under Training &amp; validation.</p></>}
      </article>
    </div>
    <article className="cv-model-card"><h4>Deployment &amp; service event log</h4>
      {registry?.history.length || serviceEvents.length ? <div className="table-scroll"><table><caption>Model switches and API start/stop events, newest first</caption><thead><tr><th scope="col">Event</th><th scope="col">Detail</th><th scope="col">Recorded time</th></tr></thead><tbody>
        {registry?.history.map((item, index) => <tr key={`model-${index}`}><td>{item.event.replaceAll("_", " ")}</td><td>{item.version || item.architecture}</td><td>{item.activated_at ? new Date(item.activated_at).toLocaleString() : "Initial configuration (no timestamp)"}</td></tr>)}
        {serviceEvents.map((item, index) => <tr key={`svc-${index}`}><td>{item.kind === "service_started" ? "API started" : "API stopping"}</td><td>{item.message}</td><td>{new Date(item.created_at.endsWith("Z") || item.created_at.includes("+") ? item.created_at : `${item.created_at}Z`).toLocaleString()}</td></tr>)}
      </tbody></table></div> : <p>{admin ? "No model switches or service events are recorded yet." : "Model switches are recorded by administrators; service events are visible to administrators only."} The connected release is pinned by checksum, so it records no model switches.</p>}
    </article>
  </>;
}
