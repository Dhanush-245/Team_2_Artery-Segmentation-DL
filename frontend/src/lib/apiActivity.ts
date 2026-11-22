/** Records when each API path last answered successfully, so pages can show an honest "last updated" time. */
const EVENT = "corovision-api-success";
const lastSuccess = new Map<string, number>();

export function recordApiSuccess(path: string) {
  const clean = path.split("?")[0];
  lastSuccess.set(clean, Date.now());
  window.dispatchEvent(new CustomEvent(EVENT, { detail: clean }));
}

/** Latest success time among paths that start with any of the given prefixes, or null. */
export function lastSuccessFor(prefixes: string[]): number | null {
  let latest: number | null = null;
  for (const [path, time] of lastSuccess) {
    if (prefixes.some((prefix) => path.startsWith(prefix)) && (latest === null || time > latest)) latest = time;
  }
  return latest;
}

export function subscribeApiActivity(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
