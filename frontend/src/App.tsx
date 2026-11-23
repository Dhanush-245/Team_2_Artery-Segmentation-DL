import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { request } from "./api";
import type { User } from "./AccountPanel";
import LoginPage from "./auth/LoginPage";
import {
  demoSignInChoices, LOOPBACK_HOSTS, NO_CAPABILITIES, TOKEN_KEY,
  type AuthCapabilities, type LoginHandoff,
} from "./auth/session";
import { forgetAccount, localDemo, saveDemoAccounts, savedAccounts, type SavedAccount } from "./demoSessions";
import { restoreUserDesign } from "./designPreview";
import { DEFAULT_SECTION, SECTION_PATHS, sectionPath } from "./routes";
import { clearAnalysisLocation } from "./savedRunNavigation";

const Workspace = lazy(() => import("./workspace/Workspace"));
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const CasesPage = lazy(() => import("./pages/CasesPage"));
const AnalysisPage = lazy(() => import("./pages/AnalysisPage"));
const ReviewsPage = lazy(() => import("./pages/ReviewsPage"));
const ReportsRoutePage = lazy(() => import("./pages/ReportsRoutePage"));
const ModelsPage = lazy(() => import("./pages/ModelsPage"));
const XaiDashboardPage = lazy(() => import("./pages/XaiDashboardPage"));
const AccountPage = lazy(() => import("./pages/AccountPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

const EMPTY_HANDOFF: LoginHandoff = { email: "", error: "", invitation: "", mfa: null, oauthMfaTicket: null };

const WorkspaceLoading = () => <div className="auth-loading" role="status">Loading your workspace…</div>;

function oauthErrorMessage(code: string) {
  if (code === "invitation_required") return "Google sign-in is verified, but this workspace requires an invitation.";
  if (code === "existing_account") return "This email already has an account. Sign in with your password first.";
  return "Social sign-in could not be completed.";
}

/** "/" and unknown paths land on the overview, except a Google account-link return, which belongs to Account. */
function landingPath(search: string) {
  return sectionPath(new URLSearchParams(search).has("oauth_linked") ? "account" : DEFAULT_SECTION);
}

/** The root address, sign-in addresses and retired pages return to the workspace; any other unknown address gets a 404 page. */
const REDIRECTED_PATHS = new Set([
  "/", "/milestones", "/milestone-tracker",
  // Sign-in entry addresses: after a successful sign-in the address is still the one the person typed.
  "/login", "/signin", "/sign-in", "/signup", "/sign-up", "/register", "/forgot-password", "/reset-password",
]);
function UnknownRoute() {
  const location = useLocation();
  const path = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname;
  if (REDIRECTED_PATHS.has(path)) return <Navigate to={{ pathname: landingPath(location.search), search: location.search }} replace />;
  return <NotFoundPage />;
}

/** Path + query without the given query parameters (and optionally without the hash). */
function currentLocationWithout(keys: string[], dropHash = false) {
  const url = new URL(window.location.href);
  keys.forEach((key) => url.searchParams.delete(key));
  return url.pathname + url.search + (dropHash ? "" : url.hash);
}

/** Session shell and router: sign-in for signed-out visitors, one URL per workspace section otherwise. */
function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState(() => {
    localStorage.removeItem(TOKEN_KEY);
    return sessionStorage.getItem(TOKEN_KEY) || "";
  });
  const [user, setUser] = useState<User | null>(null);
  const [capabilities, setCapabilities] = useState<AuthCapabilities>(NO_CAPABILITIES);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<SavedAccount[]>(savedAccounts);
  const [handoff, setHandoff] = useState<LoginHandoff>(() => ({
    ...EMPTY_HANDOFF, invitation: new URLSearchParams(window.location.hash.slice(1)).get("invite") || "",
  }));
  const activeTokenRef = useRef(token);
  activeTokenRef.current = token;

  useEffect(() => { restoreUserDesign(user?.id); }, [user?.id]);

  function startSession(next: string) {
    sessionStorage.setItem(TOKEN_KEY, next);
    setHandoff(EMPTY_HANDOFF);
    setToken(next);
  }

  /** Drop a saved-run location (?case_id/image_id/run_id) so it is not reopened by the next session. */
  function clearAnalysisNavigation() {
    navigate(clearAnalysisLocation(window.location.href), { replace: true });
  }

  function clearSession() {
    setDemoAccounts(forgetAccount(token));
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    const search = new URL(clearAnalysisLocation(window.location.href), window.location.origin).search;
    navigate({ pathname: sectionPath(DEFAULT_SECTION), search }, { replace: true });
  }

  async function signOut() {
    try {
      await request("/api/auth/logout", token, undefined, "POST");
    } catch {
      // Clear the browser session even if the server already expired it.
    } finally {
      clearSession();
    }
  }

  async function switchDemoSignIn(account: SavedAccount) {
    await signOut();
    setHandoff({ ...EMPTY_HANDOFF, email: account.email });
  }

  function switchAccount(account: SavedAccount, preserveRequestedNavigation = false) {
    if (!localDemo || account.token === activeTokenRef.current) return;
    const kept = preserveRequestedNavigation ? window.location.href : clearAnalysisLocation(window.location.href);
    const search = new URL(kept, window.location.origin).search;
    sessionStorage.setItem(TOKEN_KEY, account.token);
    setUser(null);
    navigate({ pathname: sectionPath(DEFAULT_SECTION), search }, { replace: true });
    setToken(account.token);
  }

  useEffect(() => {
    const invitation = handoff.invitation;
    const ticket = new URLSearchParams(window.location.search).get("auth_ticket");
    const oauthError = new URLSearchParams(window.location.search).get("auth_error");
    if (invitation || ticket || oauthError) navigate(currentLocationWithout(["auth_ticket", "auth_error"], Boolean(invitation)), { replace: true });

    request<AuthCapabilities>("/api/auth/capabilities").then((next) => {
      setCapabilities(next);
      if (!next.demo_signin_switcher || !LOOPBACK_HOSTS.includes(window.location.hostname)) return;
      const role = new URLSearchParams(window.location.search).get("demo_role");
      const choice = demoSignInChoices.find((account) => account.role === role);
      if (!choice) return;
      navigate(currentLocationWithout(["demo_role"]), { replace: true });
      if (!sessionStorage.getItem(TOKEN_KEY) && !invitation) setHandoff((current) => ({ ...current, email: choice.email }));
    }).catch(() => {}).finally(() => setCapabilitiesLoaded(true));

    if (localDemo) {
      request<{ accounts: SavedAccount[] }>("/api/auth/demo-accounts")
        .then((res) => {
          if (!res.accounts?.length) return;
          setDemoAccounts([...saveDemoAccounts(res.accounts)]);
          // Explicit local-demo navigation uses the existing demo roster/session flow.
          // No passwords or session tokens are placed in URLs.
          if (!LOOPBACK_HOSTS.includes(window.location.hostname)) return;
          const role = new URLSearchParams(window.location.search).get("demo_role");
          const choice = res.accounts.find((account) => account.role === role && account.email.endsWith(".demo@example.com"));
          if (!choice) return;
          navigate(currentLocationWithout(["demo_role"]), { replace: true });
          switchAccount(choice, true);
        })
        .catch(() => {});
    }

    if (oauthError) setHandoff((current) => ({ ...current, error: oauthErrorMessage(oauthError) }));
    if (ticket) {
      request<{ access_token?: string; mfa_required?: boolean; enrollment_key?: string }>("/api/auth/oauth/exchange", undefined, { ticket }, "POST")
        .then((result) => {
          if (result.mfa_required) { setHandoff((current) => ({ ...current, mfa: result, oauthMfaTicket: ticket })); return; }
          if (!result.access_token) throw new Error("Google sign-in did not return a session.");
          startSession(result.access_token);
        })
        .catch((cause: Error) => setHandoff((current) => ({ ...current, error: cause.message })));
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    request<User>("/api/auth/me", token)
      .then((profile) => {
        if (active && token === activeTokenRef.current) setUser(profile);
      })
      .catch(() => {
        if (!active || token !== activeTokenRef.current) return;
        setDemoAccounts(forgetAccount(token));
        sessionStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_KEY);
        clearAnalysisNavigation();
        setToken("");
      });
    return () => { active = false; };
  }, [token]);

  if (!token) return <LoginPage capabilities={capabilities} capabilitiesLoaded={capabilitiesLoaded} handoff={handoff} onSession={startSession} />;
  if (!user) return <WorkspaceLoading />;

  const demoSwitcher = capabilities.demo_signin_switcher;
  const session = {
    token, user, onUser: setUser,
    savedAccounts: demoSwitcher && localDemo ? demoSignInChoices : demoAccounts.filter((account) => account.id !== user.id),
    onSwitchAccount: demoSwitcher ? switchDemoSignIn : (account: SavedAccount) => switchAccount(account),
    onSignOut: signOut,
    onClearSession: clearSession,
  };

  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <Routes>
        <Route element={<Workspace session={session} />}>
          <Route path={SECTION_PATHS.overview} element={<OverviewPage />} />
          <Route path={SECTION_PATHS.cases} element={<CasesPage />} />
          <Route path={SECTION_PATHS.uploads} element={<CasesPage />} />
          <Route path={SECTION_PATHS.analysis} element={<AnalysisPage />} />
          <Route path={SECTION_PATHS.reviews} element={<ReviewsPage />} />
          <Route path={SECTION_PATHS.reports} element={<ReportsRoutePage />} />
          <Route path={SECTION_PATHS.models} element={<ModelsPage />} />
          <Route path={SECTION_PATHS.xai} element={<XaiDashboardPage />} />
          <Route path={SECTION_PATHS.account} element={<AccountPage />} />
          <Route path={SECTION_PATHS.admin} element={<AdminPage section="users" />} />
          <Route path={SECTION_PATHS.permissions} element={<AdminPage section="permissions" />} />
          <Route path={SECTION_PATHS.access} element={<AdminPage section="access" />} />
          <Route path={SECTION_PATHS.audit} element={<AdminPage section="audit" />} />
        </Route>
        <Route path="*" element={<UnknownRoute />} />
      </Routes>
    </Suspense>
  );
}

export default App;
