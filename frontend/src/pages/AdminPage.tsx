import AdminPanel from "../AdminPanel";
import OperationsPanel from "../OperationsPanel";
import { useWorkspace } from "../workspace/WorkspaceContext";

export type AdminSection = "users" | "permissions" | "access" | "audit" | "operations";

export default function AdminPage({ section }: { section: AdminSection }) {
  const { token, user } = useWorkspace();
  if (section === "operations") return <OperationsPanel token={token} />;
  return <AdminPanel key={section} section={section} token={token} currentUser={user} />;
}
