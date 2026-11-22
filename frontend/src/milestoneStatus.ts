import type { SidebarView } from "./components/watermelon/macos-sidebar";

/**
 * Snapshot of recorded acceptance status. Statuses are copied verbatim from the
 * repository reports named in `source`; nothing here is inferred by the UI.
 * Update this file whenever those reports change.
 */
export type RecordedStatus = "PASS" | "PARTIAL" | "BLOCKED" | "NOT_TESTED" | "IN_PROGRESS" | "TODO";

export type StatusTone = "verified" | "partial" | "blocked" | "pending";

export const STATUS_LABEL: Record<RecordedStatus, { label: string; tone: StatusTone }> = {
  PASS: { label: "Verified", tone: "verified" },
  PARTIAL: { label: "Partial", tone: "partial" },
  BLOCKED: { label: "Blocked", tone: "blocked" },
  NOT_TESTED: { label: "Not tested", tone: "pending" },
  IN_PROGRESS: { label: "In progress", tone: "pending" },
  TODO: { label: "To do", tone: "pending" },
};

export type MilestoneTask = {
  id: string;
  title: string;
  status: RecordedStatus;
  /** Exact acceptance wording from the report, e.g. "PASS for local foundation". */
  recorded: string;
  scope: string;
  source: SourceKey;
  screen?: SidebarView;
};

export type Milestone = { number: 1 | 2 | 3 | 4; title: string; weeks: string; overall: RecordedStatus; overallNote: string; tasks: MilestoneTask[] };

export const MILESTONE_SOURCES = {
  acceptance: { file: "reports/MILESTONE_4_FINAL_ACCEPTANCE.md", recorded: "18 Nov 2026" },
  queue: { file: "reports/MASTER_PROJECT_TASK_QUEUE.md", recorded: "21 Nov 2026" },
} as const;
export type SourceKey = keyof typeof MILESTONE_SOURCES;

export const MILESTONES: Milestone[] = [
  {
    number: 1, title: "Project initialization, datasets, core setup", weeks: "Weeks 1–2", overall: "PARTIAL",
    overallNote: "Local foundation passes; PostgreSQL upgrade and rollback were open at closeout.",
    tasks: [
      { id: "F-01", title: "Data and foundation: EDA, manifests, login, authorized cases and preprocessing", status: "PASS", recorded: "PASS for local foundation", scope: "Local input and role checks", source: "acceptance", screen: "cases" },
      { id: "F-02", title: "Persistence and recovery", status: "PARTIAL", recorded: "PARTIAL", scope: "Legacy PostgreSQL upgrade, HTTP/report persistence and rollback rehearsal open", source: "acceptance" },
      { id: "M1-01", title: "Additive PostgreSQL upgrade and backup rollback", status: "PASS", recorded: "PASS", scope: "Disposable data against the historical schema; hosted recovery separate", source: "queue" },
    ],
  },
  {
    number: 2, title: "Artery segmentation and vessel analysis", weeks: "Weeks 3–4", overall: "PARTIAL",
    overallNote: "Development workflows demonstrated; independent segmentation and measurement evidence outstanding.",
    tasks: [
      { id: "S-01", title: "Segmentation and visual evidence (2D and 3D masks, centerlines)", status: "PARTIAL", recorded: "PARTIAL", scope: "Independent expert masks and native-resolution CTA references outstanding", source: "acceptance", screen: "analysis" },
      { id: "S-02", title: "Vessel width and diameter measurements", status: "PARTIAL", recorded: "PARTIAL", scope: "Qualified QCA, calibration and reference agreement outstanding", source: "acceptance", screen: "analysis" },
      { id: "M2-01", title: "Independent segmentation evidence", status: "BLOCKED", recorded: "BLOCKED", scope: "Eligible independent cohort and CTA references required", source: "queue", screen: "models" },
    ],
  },
  {
    number: 3, title: "Stenosis detection, severity, explainability", weeks: "Weeks 5–6", overall: "PARTIAL",
    overallNote: "Candidate localization, experimental severity and explainability exist; reference agreement and faithfulness outstanding.",
    tasks: [
      { id: "D-01", title: "Stenosis candidates and experimental severity with abstention", status: "PARTIAL", recorded: "PARTIAL", scope: "Expert localization, MLD/RVD and matched severity grades outstanding", source: "acceptance", screen: "analysis" },
      { id: "D-02", title: "Explainability (activation and candidate Grad-CAM)", status: "PARTIAL", recorded: "PARTIAL", scope: "Complete insertion and randomization evidence outstanding", source: "acceptance", screen: "analysis" },
      { id: "M3-01", title: "Localization and severity reference agreement", status: "BLOCKED", recorded: "BLOCKED", scope: "Calibrated references and matched expert grades required", source: "queue", screen: "reviews" },
      { id: "M3-02", title: "Explainability faithfulness checks", status: "TODO", recorded: "TODO", scope: "Insertion, deletion and randomization checks", source: "queue", screen: "analysis" },
    ],
  },
  {
    number: 4, title: "Reporting, testing, analytics, deployment", weeks: "Weeks 7–8", overall: "PARTIAL",
    overallNote: "Local reports and focused regression pass; browser, documentation and operational items open; deployment not performed.",
    tasks: [
      { id: "R-01", title: "Reports and exports", status: "PASS", recorded: "PASS for tested local scope", scope: "Deployed access checks open", source: "acceptance", screen: "reports" },
      { id: "M4-01", title: "Report gallery original rendering", status: "PASS", recorded: "PASS", scope: "Local Chrome verification", source: "queue", screen: "reports" },
      { id: "M4-02", title: "Report export authorization and PDF layout", status: "PASS", recorded: "PASS", scope: "Local scope", source: "queue", screen: "reports" },
      { id: "M4-07", title: "Automatic report creation bound to the exact run", status: "PASS", recorded: "PASS", scope: "Native API integration with the frozen worker", source: "queue", screen: "reports" },
      { id: "M4-06", title: "Saved 3D NIfTI run exports (PDF, JSON, CSV, Evidence ZIP)", status: "PASS", recorded: "PASS", scope: "Local researcher browser session", source: "queue", screen: "reports" },
      { id: "R-02", title: "Dashboards and roles", status: "PARTIAL", recorded: "PARTIAL", scope: "Exhaustive keyboard, responsive and admin browser acceptance open", source: "acceptance", screen: "overview" },
      { id: "M4-03", title: "Primary navigation across seven demo roles", status: "PASS", recorded: "PASS", scope: "Preserved browser evidence", source: "queue", screen: "overview" },
      { id: "R-03", title: "Model evaluation and selection", status: "PARTIAL", recorded: "PARTIAL", scope: "Threshold selection and protected evaluation open", source: "acceptance", screen: "models" },
      { id: "R-01·sweep", title: "Frozen-checkpoint stenosis threshold sweep", status: "PASS", recorded: "PASS", scope: "Decision recorded: retain score 0.25 / pixel 0.5", source: "queue", screen: "models" },
      { id: "R-04", title: "Tests, latency and monitoring", status: "PARTIAL", recorded: "PARTIAL", scope: "Latency under load, resource peaks and alert checks open", source: "acceptance", screen: "audit" },
      { id: "M4-08", title: "Administrator MFA and invitation-only sign-up on a reviewed revision", status: "BLOCKED", recorded: "BLOCKED", scope: "Verified only in the local workspace", source: "queue", screen: "admin" },
      { id: "R-05", title: "Containers and deployment readiness", status: "BLOCKED", recorded: "BLOCKED", scope: "Image build, scan, restart and persistence tests", source: "acceptance" },
      { id: "M4-04", title: "Production image hardening and vulnerability triage", status: "IN_PROGRESS", recorded: "IN_PROGRESS", scope: "Latest rescan 0 critical / 126 high", source: "queue" },
      { id: "R-06", title: "Actual deployment", status: "NOT_TESTED", recorded: "NOT_TESTED", scope: "Hosting target and explicit deployment authorization required", source: "acceptance" },
      { id: "M4-05", title: "Target deployment, monitoring and operational acceptance", status: "BLOCKED", recorded: "BLOCKED", scope: "Selected target and deployment authorization required", source: "queue" },
      { id: "R-07", title: "Final handoff documentation and demonstration", status: "PARTIAL", recorded: "PARTIAL", scope: "Final presentation and full live demonstration acceptance open", source: "acceptance" },
    ],
  },
];
