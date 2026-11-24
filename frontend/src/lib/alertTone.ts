import type { AlertTone } from "../components/watermelon/alert-1";

/**
 * Maps the API's alert levels (informational, low, medium, high, critical) to the notification colour.
 * Critical and high alerts must stand out; medium is a warning; informational and low stay neutral.
 */
export function alertTone(level: string | null | undefined): AlertTone {
  switch ((level || "").toLowerCase()) {
    case "critical":
    case "high":
    case "error":
      return "error";
    case "medium":
    case "warning":
      return "warning";
    case "success":
      return "success";
    default:
      return "info";
  }
}
