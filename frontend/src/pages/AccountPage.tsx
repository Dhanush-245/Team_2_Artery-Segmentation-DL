import AccountPanel from "../AccountPanel";
import { useWorkspace } from "../workspace/WorkspaceContext";

export default function AccountPage() {
  const { token, user, session } = useWorkspace();
  return <AccountPanel token={token} user={user} onUser={session.onUser} onLogout={session.onClearSession} />;
}
