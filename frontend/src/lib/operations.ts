export type OpsLevel = "info" | "warning" | "error" | "critical";

export type OpsEvent = { id: string; created_at: string; level: OpsLevel; kind: string; message: string; details: Record<string, unknown> };
export type OpsSignals = {
  memory: { used_bytes: number; limit_bytes: number | null; percent: number | null };
  storage: { free_bytes: number; total_bytes: number };
  ready: boolean; server_errors: number; failed_jobs: number;
};
export type OpsAlerts = {
  monitor: { enabled: boolean; running: boolean; last_run: string | null };
  settings: Record<string, number | boolean>;
  signals: OpsSignals;
  conditions_now: { name: string; level: OpsLevel; message: string }[];
  channels: { in_app_admin_notifications: boolean; webhook: boolean };
  recent_alerts: OpsEvent[];
};
export type OpsSnapshot = { at: string; requests: number; server_errors: number; memory_percent: number | null; memory_used_mb: number; storage_free_mb: number; ready: boolean; failed_jobs_recent: number };

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Short, plain-language state for one signal so an administrator can scan the page quickly. */
export function memoryStatus(memory: OpsSignals["memory"], warnPercent: number): { label: string; level: OpsLevel } {
  if (memory.percent === null) return { label: `${formatBytes(memory.used_bytes)} used (no container limit detected)`, level: "info" };
  const label = `${memory.percent}% of ${formatBytes(memory.limit_bytes)} (${formatBytes(memory.used_bytes)})`;
  return { label, level: memory.percent >= warnPercent ? "error" : "info" };
}

export function levelRank(level: OpsLevel): number {
  return ({ info: 0, warning: 1, error: 2, critical: 3 } as const)[level] ?? 0;
}

/** Highest level among the alerts that are firing now; "info" means all clear. */
export function overallLevel(conditions: { level: OpsLevel }[]): OpsLevel {
  return conditions.reduce<OpsLevel>((top, item) => (levelRank(item.level) > levelRank(top) ? item.level : top), "info");
}
