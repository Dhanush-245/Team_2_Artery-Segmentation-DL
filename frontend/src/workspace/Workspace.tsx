import "../styles/sections.css";
import WorkspaceLayout from "./WorkspaceLayout";
import { WorkspaceProvider, type WorkspaceSession } from "./WorkspaceContext";

/** Signed-in workspace: per-session state plus the shared layout. Loaded lazily so sign-in stays light. */
export default function Workspace({ session }: { session: WorkspaceSession }) {
  return <WorkspaceProvider key={session.token} session={session}><WorkspaceLayout /></WorkspaceProvider>;
}
