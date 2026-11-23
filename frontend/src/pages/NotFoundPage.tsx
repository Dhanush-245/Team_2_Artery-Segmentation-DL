import { useEffect } from "react";
import { Link } from "react-router-dom";
import { APP_NAME } from "../sectionMeta";
import { DEFAULT_SECTION, sectionPath } from "../routes";

/** Shown for addresses that are not part of the workspace, instead of silently redirecting. */
export default function NotFoundPage() {
  useEffect(() => { document.title = `Page not found · ${APP_NAME}`; }, []);
  return (
    <main className="not-found" id="main-content">
      <Link className="not-found-brand" to={sectionPath(DEFAULT_SECTION)} aria-label={`${APP_NAME} home`}>
        <img src="/corovision-heart-mark.png" alt="" width="40" height="40" />
        <span>{APP_NAME}</span>
      </Link>
      <h1>Page not found</h1>
      <p>This address is not part of the workspace. The link may be old or mistyped.</p>
      <Link className="not-found-action" to={sectionPath(DEFAULT_SECTION)}>Back to the dashboard</Link>
    </main>
  );
}
