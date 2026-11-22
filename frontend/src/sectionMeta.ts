import type { SidebarView } from "./components/watermelon/macos-sidebar";

export type SectionMeta = {
  /** Short page name used in the browser tab title. */
  title: string;
  /** One-line description of what the section is for. */
  description: string;
  /** Brief module(s) and milestone the section implements (PRD §22 roadmap). */
  modules: string;
  /** API endpoint(s) the section reads; also used to time "last updated". */
  endpoints: string[];
  /** For sections backed by a recorded snapshot rather than an API: when the source was recorded. */
  snapshot?: string;
};

export const APP_NAME = "CoroVision AI";

export const SECTION_META: Record<SidebarView, SectionMeta> = {
  overview: {
    title: "Dashboard",
    description: "Role-specific summary of your cases, tasks and recent activity.",
    modules: "Role dashboards · Milestone 4",
    endpoints: ["/api/cases", "/api/tasks", "/api/dashboard/analytics"],
  },
  cases: {
    title: "Cases",
    description: "Authorized de-identified studies, their access, assets, reviews and analysis history.",
    modules: "Case management and preprocessing · Milestone 1",
    endpoints: ["/api/cases"],
  },
  uploads: {
    title: "Data & Uploads",
    description: "Validate and prepare angiography images and research volumes for a case.",
    modules: "Data intake and preprocessing · Milestone 1",
    endpoints: ["/api/cases"],
  },
  analysis: {
    title: "AI Analysis",
    description: "Artery segmentation, vessel measurements, stenosis candidates and explainability for a saved run.",
    modules: "Segmentation and vessel analysis · Milestone 2; stenosis detection and explainability · Milestone 3",
    endpoints: ["/api/images", "/api/analysis"],
  },
  reviews: {
    title: "Severity Review",
    description: "Queue of cases awaiting clinical review of AI stenosis findings.",
    modules: "Stenosis severity review · Milestone 3",
    endpoints: ["/api/cases"],
  },
  models: {
    title: "Model Evaluation",
    description: "Installed model versions, imported validation evidence and training history.",
    modules: "Model evaluation and selection · Milestone 4",
    endpoints: ["/api/analysis/models", "/api/analysis/status", "/api/evaluation/runs", "/api/models/registry"],
  },
  reports: {
    title: "Reports",
    description: "Immutable report snapshots and protected exports bound to an exact saved run.",
    modules: "Reports and exports · Milestone 4",
    endpoints: ["/api/cases", "/api/images"],
  },
  account: {
    title: "Profile & Settings",
    description: "Your profile, password, connected sign-in methods and active sessions.",
    modules: "Authentication and accounts · Milestone 1",
    endpoints: ["/api/auth"],
  },
  admin: {
    title: "User Management",
    description: "Create, invite and manage user accounts and roles.",
    modules: "Role-based access · Milestones 1 and 4",
    endpoints: ["/api/admin/users", "/api/admin/invitations"],
  },
  permissions: {
    title: "Roles & Permissions",
    description: "What each role may see and do across the workspace.",
    modules: "Role-based access · Milestones 1 and 4",
    endpoints: ["/api/admin/users"],
  },
  access: {
    title: "Case Access",
    description: "Case assignments, access requests and the recoverable case trash.",
    modules: "Role-based access · Milestones 1 and 4",
    endpoints: ["/api/admin/trash", "/api/admin/access-requests"],
  },
  audit: {
    title: "Audit Logs",
    description: "Recorded security and workflow events across the workspace.",
    modules: "Monitoring and audit · Milestone 4",
    endpoints: ["/api/admin/audit"],
  },
  milestones: {
    title: "Milestone Tracker",
    description: "The four delivery milestones, their tasks, verified status and the screen that delivers each.",
    modules: "Delivery tracking · Milestones 1–4",
    endpoints: [],
    snapshot: "Reports recorded 18–21 Nov 2026",
  },
};

export function documentTitle(view: SidebarView): string {
  return `${SECTION_META[view].title} · ${APP_NAME}`;
}
