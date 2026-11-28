// Browser-tab preferences, scoped to the case or saved run.
export function readViewerSession<T>(key: string, fallback: T): T {
  try {
    const value = sessionStorage.getItem('corovision.viewer.' + key);
    return value === null ? fallback : JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function saveViewerSession(key: string, value: unknown) {
  try { sessionStorage.setItem('corovision.viewer.' + key, JSON.stringify(value)); }
  catch { /* Storage may be disabled. The viewer still works. */ }
}
