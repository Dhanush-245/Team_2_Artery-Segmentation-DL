import { FormEvent, lazy, Suspense, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { apiUrl, request } from "../api";
import { Button } from "../components/prismui/button";
import { Input } from "../components/prismui/input";
import { Label } from "../components/prismui/label";
import Auth7 from "../components/ui/auth-07";
import { GoogleLogo } from "../SocialLogos";
import { APP_NAME } from "../sectionMeta";
import { registrationOpen, type AuthCapabilities, type LoginHandoff, type MfaChallenge } from "./session";

// The animated theme toggle pulls in the motion library; keep it off the sign-in critical path.
const SwitchMode = lazy(() => import("../components/watermelon/switch-mode").then((module) => ({ default: module.SwitchMode })));

const THEME_SWITCH_SIZE = { width: 76, height: 38 };
const MIN_PASSWORD_LENGTH = 12;

type LoginResult = { access_token?: string; mfa_required?: boolean; enrollment_key?: string };

type Props = {
  capabilities: AuthCapabilities;
  capabilitiesLoaded: boolean;
  handoff: LoginHandoff;
  onSession: (token: string) => void;
};

function SocialSignIn({ capabilities, capabilitiesLoaded }: Pick<Props, "capabilities" | "capabilitiesLoaded">) {
  return <div className="wm-auth-social">
    <Button type="button" variant="outline" className="wm-social-button" disabled={!capabilities.google} onClick={() => window.location.assign(apiUrl("/api/auth/oauth/google/start"))}>
      <GoogleLogo /> Continue with Google
    </Button>
    {capabilitiesLoaded && !capabilities.google && <p className="wm-auth-help">Google sign-in is unavailable until OAuth credentials are configured.</p>}
  </div>;
}

function MfaChallengeFields({ mfa, mfaCode, setMfaCode }: { mfa: MfaChallenge | null; mfaCode: string; setMfaCode: (code: string) => void }) {
  return <section className="wm-mfa-enrollment" aria-labelledby="mfa-enrollment-heading">
    <p className="wm-mfa-badge" id="mfa-enrollment-heading"><ShieldCheck aria-hidden="true" />Administrator security check</p>
    {mfa?.enrollment_key && <>
      <ol className="wm-mfa-steps">
        <li>Open an authenticator app such as Google Authenticator or Microsoft Authenticator.</li>
        <li>Add a new account using the setup key below.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <details className="wm-mfa-key"><summary>Show setup key</summary><code>{mfa.enrollment_key}</code><p>Keep this key private. You only need it once, to add this account.</p></details>
    </>}
    <Label htmlFor="mfa-code">Authenticator code</Label>
    <Input id="mfa-code" className="wm-otp-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" aria-describedby="mfa-code-help" value={mfaCode} onChange={event => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required autoFocus />
    <p className="wm-auth-help" id="mfa-code-help">Codes refresh every 30 seconds. Enter the current one.</p>
  </section>;
}

/** Sign-in, invitation sign-up, MFA and password reset. Rendered for every path while signed out. */
export default function LoginPage({ capabilities, capabilitiesLoaded, handoff, onSession }: Props) {
  const [email, setEmail] = useState(handoff.email);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invitation, setInvitation] = useState(handoff.invitation);
  const [registering, setRegistering] = useState(Boolean(handoff.invitation));
  const [mfa, setMfa] = useState<MfaChallenge | null>(handoff.mfa);
  const [mfaCode, setMfaCode] = useState("");
  const [oauthMfaTicket, setOauthMfaTicket] = useState<string | null>(handoff.oauthMfaTicket);
  const [resetting, setResetting] = useState(false);
  const [resetStep, setResetStep] = useState<"request" | "confirm">("request");
  const [resetContact, setResetContact] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [authNotice, setAuthNotice] = useState("");
  const [error, setError] = useState(handoff.error);
  const [busy, setBusy] = useState(false);

  // The shell may resolve a handoff (OAuth return, demo prefill) after this form has mounted.
  useEffect(() => { if (handoff.email) setEmail(handoff.email); }, [handoff.email]);
  useEffect(() => { if (handoff.error) setError(handoff.error); }, [handoff.error]);
  useEffect(() => {
    if (!handoff.mfa) return;
    setMfa(handoff.mfa);
    setOauthMfaTicket(handoff.oauthMfaTicket);
  }, [handoff.mfa, handoff.oauthMfaTicket]);

  useEffect(() => { document.title = `${registering ? "Create account" : resetting ? "Reset password" : "Sign in"} · ${APP_NAME}`; }, [registering, resetting]);

  const canRegister = registrationOpen(capabilities, capabilitiesLoaded, invitation);
  const mfaPending = Boolean(mfa && !registering && !resetting);

  function clearMessages() {
    setError("");
    setAuthNotice("");
  }

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (oauthMfaTicket) {
        const result = await request<{ access_token?: string }>("/api/auth/oauth/exchange", undefined, { ticket: oauthMfaTicket, mfa_code: mfaCode }, "POST");
        if (!result.access_token) throw new Error("Google sign-in did not return a session.");
        setOauthMfaTicket(null);
        setMfa(null);
        setMfaCode("");
        onSession(result.access_token);
        return;
      }
      if (registering) {
        await request("/api/auth/register", undefined, { email, password, display_name: displayName, username: username || undefined, invitation: invitation || undefined }, "POST");
        setRegistering(false);
        setInvitation("");
      }
      const result = await request<LoginResult>(
        "/api/auth/login", undefined, { identifier: email, password, remember: rememberMe, mfa_code: mfaCode || undefined }, "POST",
      );
      if (result.mfa_required) {
        setMfa(result);
        return;
      }
      if (!result.access_token) throw new Error("Sign-in did not return a session.");
      setMfa(null);
      setMfaCode("");
      setPassword("");
      onSession(result.access_token);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(event: FormEvent) {
    event.preventDefault();
    clearMessages();
    setBusy(true);
    try {
      if (resetStep === "request") {
        await request("/api/auth/password-reset/request", undefined, { contact: resetContact }, "POST");
        setResetStep("confirm");
        setAuthNotice("If this verified contact belongs to an account, a six-digit code has been sent.");
      } else {
        await request("/api/auth/password-reset/confirm", undefined,
          { contact: resetContact, code: resetCode, new_password: resetPassword }, "POST");
        setResetting(false);
        setResetStep("request");
        setResetCode("");
        setResetPassword("");
        setAuthNotice("Password reset. Sign in with your new password.");
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function leaveMfa() {
    setMfa(null);
    setMfaCode("");
    setOauthMfaTicket(null);
    clearMessages();
  }

  function toggleMode() {
    if (resetting) setResetting(false);
    else setRegistering(!registering);
    setMfa(null);
    setMfaCode("");
    clearMessages();
  }

  const showModeSwitch = resetting || registering || canRegister;
  const footer = mfaPending
    ? <p className="wm-auth-switch">Not you?{" "}<button type="button" onClick={leaveMfa}>Return to sign in</button></p>
    : showModeSwitch ? <p className="wm-auth-switch">
      {resetting ? "Remember your password?" : registering ? "Already have an account?" : "Don't have an account?"}{" "}
      <button type="button" onClick={toggleMode}>{resetting || registering ? "Sign in" : "Sign up"}</button>
    </p> : undefined;

  const messages = <>
    {error && <p className="wm-auth-message wm-auth-error" role="alert">{error}</p>}
    {authNotice && <p className="wm-auth-message" role="status">{authNotice}</p>}
  </>;

  return (
    <>
      <div className="theme-switch-float">
        <Suspense fallback={<span style={{ display: "inline-block", ...THEME_SWITCH_SIZE }} aria-hidden="true" />}>
          <SwitchMode {...THEME_SWITCH_SIZE} />
        </Suspense>
      </div>
      <Auth7
        title={mfaPending ? "Verify it's you" : resetting ? "Reset your password" : registering ? "Create your account" : "Welcome back"}
        description={mfaPending ? (mfa?.enrollment_key ? "Add CoroVision AI to your authenticator app, then enter the 6-digit code it shows." : "Enter the 6-digit code from your authenticator app to finish signing in.") : resetting ? "Get a one-time code by email." : registering ? "Join the CoroVision AI research workspace." : "Sign in to access coronary vessel analysis."}
        social={mfaPending || resetting ? undefined : <SocialSignIn capabilities={capabilities} capabilitiesLoaded={capabilitiesLoaded} />}
        footer={footer}
      >
        {resetting ? (
          <form className="wm-auth-form" onSubmit={handleReset}>
            <Label htmlFor="reset-contact">Email</Label>
            <Input id="reset-contact" type="email" autoComplete="email" placeholder="you@example.com" value={resetContact} onChange={(event) => setResetContact(event.target.value)} required />
            {resetStep === "confirm" && (
              <>
                <Label htmlFor="reset-code">Six-digit code</Label>
                <Input id="reset-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="Enter your code" value={resetCode} onChange={(event) => setResetCode(event.target.value)} required />
                <Label htmlFor="reset-password">New password</Label>
                <Input id="reset-password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} placeholder="At least 12 characters" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required />
              </>
            )}
            {messages}
            {!capabilities.email_reset && <p className="wm-auth-help">Email delivery must be configured by the project administrator.</p>}
            <Button className="wm-auth-submit" disabled={busy || !capabilities.email_reset}>{busy ? "Please wait…" : resetStep === "request" ? "Send code" : "Reset password"}</Button>
          </form>
        ) : (
          <form className="wm-auth-form" onSubmit={handleAuth}>
            {mfaPending ? <MfaChallengeFields mfa={mfa} mfaCode={mfaCode} setMfaCode={setMfaCode} /> : <>
              {registering && (
                <>
                  <Label htmlFor="display-name">Display name</Label>
                  <Input id="display-name" autoComplete="name" maxLength={100} placeholder="Enter your name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                  <Label htmlFor="username">Username</Label>
                  <Input id="username" autoComplete="username" placeholder="Choose a username" value={username} onChange={(event) => setUsername(event.target.value)} required />
                </>
              )}
              <Label htmlFor="email">{registering ? "Email" : "Username or email"}</Label>
              <Input id="email" type={registering ? "email" : "text"} autoComplete="username" placeholder={registering ? "Enter your email" : "Enter username or email"} value={email} onChange={(event) => setEmail(event.target.value)} required />
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete={registering ? "new-password" : "current-password"} placeholder="Enter your password" minLength={registering ? MIN_PASSWORD_LENGTH : undefined} value={password} onChange={(event) => setPassword(event.target.value)} required />
              {registering ? <p className="wm-auth-help">Use at least 12 characters.</p> : (
                <div className="wm-auth-options">
                  <label className="wm-remember-option" htmlFor="remember-me">
                    <input id="remember-me" type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                    <span title="Reloading this tab keeps your session until it expires.">Keep me signed in on this tab for 24 hours</span>
                  </label>
                  <button type="button" className="wm-auth-link" onClick={() => { clearMessages(); setResetContact(email.includes("@") ? email : ""); setResetting(true); }}>Forgot password?</button>
                </div>
              )}
              {registering && (capabilities.invitation_required || invitation) && (
                <>
                  <Label htmlFor="invitation">Invitation code</Label>
                  <Input id="invitation" type="password" autoComplete="off" value={invitation} onChange={event => setInvitation(event.target.value)} required />
                </>
              )}
            </>}
            {messages}
            <Button className="wm-auth-submit" disabled={busy || (mfaPending && mfaCode.length !== 6)}>{busy ? "Please wait…" : mfaPending ? "Verify and continue" : registering ? "Create account" : "Sign in"}</Button>
          </form>
        )}
      </Auth7>
    </>
  );
}
