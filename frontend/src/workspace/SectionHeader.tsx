import { useEffect, useSyncExternalStore } from "react";
import type { SidebarView } from "../components/watermelon/macos-sidebar";
import { lastSuccessFor, subscribeApiActivity } from "../lib/apiActivity";
import { documentTitle, SECTION_META } from "../sectionMeta";

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Keeps the browser tab title in step with the routed section. */
export function useDocumentTitle(view: SidebarView) {
  useEffect(() => { document.title = documentTitle(view); }, [view]);
}

/** One-line description, brief module/milestone, data source and last successful refresh for a section. */
export default function SectionHeader({ view }: { view: SidebarView }) {
  const meta = SECTION_META[view];
  const updated = useSyncExternalStore(subscribeApiActivity, () => lastSuccessFor(meta.endpoints));
  const fresh = updated !== null && meta.endpoints.length > 0;
  return (
    <aside className="cv-section-meta" aria-label={`${meta.title} section information`}>
      <p className="cv-section-meta-description">{meta.description}</p>
      <dl>
        <div><dt>Implements</dt><dd>{meta.modules}</dd></div>
        <div><dt>Data source</dt><dd>{meta.endpoints.length ? meta.endpoints.map((endpoint) => <code key={endpoint}>{endpoint}</code>) : "Recorded acceptance reports (snapshot)"}</dd></div>
        <div><dt>Last updated</dt><dd>{meta.snapshot ?? (fresh
          ? <time dateTime={new Date(updated).toISOString()}>{TIME_FORMAT.format(updated)}</time>
          : "Waiting for data…")}</dd></div>
      </dl>
    </aside>
  );
}
