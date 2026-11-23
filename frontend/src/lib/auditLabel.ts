/**
 * Turns a stored audit action such as "xai_verification_requested:990f990ce6688254" into a readable label
 * ("xai verification requested · 990f990c"). Raw identifiers are shortened so they cannot stretch a phone layout.
 */
export function formatAuditAction(action: string): string {
  const [name, ...rest] = action.split(":");
  const label = name.replaceAll("_", " ").trim();
  const reference = rest.join(":").trim();
  return reference ? `${label} · ${reference.slice(0, 8)}` : label;
}
