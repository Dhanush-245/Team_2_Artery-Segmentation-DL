import { useEffect } from "react";
import type { SidebarView } from "../components/watermelon/macos-sidebar";
import { documentTitle } from "../sectionMeta";

/** Keeps the browser tab title in step with the routed section. */
export function useDocumentTitle(view: SidebarView) {
  useEffect(() => { document.title = documentTitle(view); }, [view]);
}
