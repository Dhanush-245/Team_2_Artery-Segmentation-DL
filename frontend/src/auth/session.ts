import type { SavedAccount } from "../demoSessions";

export const TOKEN_KEY = "artery-analysis-token";

export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export type AuthCapabilities = {
  google: boolean;
  institutional_sso: boolean;
  email_reset: boolean;
  invitation_required: boolean;
  demo_signin_switcher: boolean;
};

export const NO_CAPABILITIES: AuthCapabilities = {
  google: false, institutional_sso: false, email_reset: false, invitation_required: false, demo_signin_switcher: false,
};

export type MfaChallenge = { enrollment_key?: string };

/** Values the shell hands to the sign-in form (OAuth return, demo prefill, invitation link). */
export type LoginHandoff = {
  email: string;
  error: string;
  invitation: string;
  mfa: MfaChallenge | null;
  oauthMfaTicket: string | null;
};

export const demoSignInChoices: SavedAccount[] = [
  ["doctor", "doctor", "Demo Doctor"],
  ["radiologist", "clinician", "Demo Clinician"],
  ["researcher", "researcher", "Demo Researcher"],
  ["mlengineer", "ml_engineer", "Demo ML Engineer"],
  ["technician", "technician", "Demo Technician"],
  ["viewer", "viewer", "Demo Viewer"],
  ["admin", "admin", "Demo Administrator"],
].map(([id, role, name]) => ({ id, role, name, email: `${id}.demo@example.com`, token: "" }));

/**
 * Self-service sign-up is open only when the backend does not require an
 * invitation (development mode), or when the visitor arrived with one.
 */
export function registrationOpen(capabilities: AuthCapabilities, loaded: boolean, invitation: string): boolean {
  return Boolean(invitation) || (loaded && !capabilities.invitation_required);
}
