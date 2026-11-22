import type { SidebarView } from "./components/watermelon/macos-sidebar";

/** One URL per workspace section. Query parameters (case_id, image_id, run_id) ride along unchanged. */
export const SECTION_PATHS: Record<SidebarView, string> = {
  overview: "/overview",
  cases: "/cases",
  uploads: "/uploads",
  analysis: "/analysis",
  reviews: "/reviews",
  models: "/models",
  xai: "/xai",
  reports: "/reports",
  account: "/account",
  admin: "/admin",
  permissions: "/admin/permissions",
  access: "/admin/access",
  audit: "/admin/audit",
};

const PATH_SECTIONS = new Map(Object.entries(SECTION_PATHS).map(([view, path]) => [path, view as SidebarView]));

export const DEFAULT_SECTION: SidebarView = "overview";

export function sectionPath(view: SidebarView): string {
  return SECTION_PATHS[view];
}

/** Returns the section for a pathname, or null when the path is not a workspace section. */
export function sectionForPath(pathname: string): SidebarView | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PATH_SECTIONS.get(normalized) ?? null;
}
