import { useEffect } from "react";
import type { SidebarView } from "../components/watermelon/macos-sidebar";
import { SECTION_META, documentTitle } from "../sectionMeta";

/** Keeps the browser tab title in step with the routed section. */
export function useDocumentTitle(view: SidebarView) {
  useEffect(() => {
    document.title = documentTitle(view);
    document.querySelector('meta[name="description"]')?.setAttribute("content", `${SECTION_META[view].description} CoroVision AI is a research prototype, not a medical device.`);
  }, [view]);
}
