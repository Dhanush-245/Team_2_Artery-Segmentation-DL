import AdminPanel from "../AdminPanel";
import { useWorkspace } from "../workspace/WorkspaceContext";

export type AdminSection = "users" | "permissions" | "access" | "audit";

export default function AdminPage({ section }: { section: AdminSection }) {
  const { token, user } = useWorkspace();
  return <AdminPanel key={section} section={section} token={token} currentUser={user} />;
}
