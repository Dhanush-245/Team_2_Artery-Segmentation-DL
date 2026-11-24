import type { SidebarView } from "./components/watermelon/macos-sidebar";

export type SectionMeta = {
  /** Short page name used in the browser tab title. */
  title: string;
  /** One-line description of what the section is for. */
  description: string;
};

export const APP_NAME = "CoroVision AI";

export const SECTION_META: Record<SidebarView, SectionMeta> = {
  overview: {
    title: "Dashboard",
    description: "Role-specific summary of your cases, tasks and recent activity.",
  },
  cases: {
    title: "Cases",
    description: "Authorized de-identified studies, their access, assets, reviews and analysis history.",
  },
  uploads: {
    title: "Data & Uploads",
    description: "Validate and prepare angiography images and research volumes for a case.",
  },
  analysis: {
    title: "AI Analysis",
    description: "Artery segmentation, vessel measurements, stenosis candidates and explainability for a saved run.",
  },
  reviews: {
    title: "Severity Review",
    description: "Queue of cases awaiting clinical review of AI stenosis findings.",
  },
  models: {
    title: "Model Evaluation",
    description: "Installed model versions, imported validation evidence and training history.",
  },
  xai: {
    title: "Explainable AI",
    description: "Coverage, methods and verification of saved case explanations.",
  },
  reports: {
    title: "Reports",
    description: "Immutable report snapshots and protected exports bound to an exact saved run.",
  },
  account: {
    title: "Profile & Settings",
    description: "Your profile, password, connected sign-in methods and active sessions.",
  },
  admin: {
    title: "User Management",
    description: "Create, invite and manage user accounts and roles.",
  },
  permissions: {
    title: "Roles & Permissions",
    description: "What each role may see and do across the workspace.",
  },
  access: {
    title: "Case Access",
    description: "Case assignments, access requests and the recoverable case trash.",
  },
  audit: {
    title: "Audit Logs",
    description: "Recorded security and workflow events across the workspace.",
  },
  operations: {
    title: "Operations",
    description: "Central operational log, live service signals and automatic alerts for administrators.",
  },
};

export function documentTitle(view: SidebarView): string {
  return `${SECTION_META[view].title} · ${APP_NAME}`;
}
