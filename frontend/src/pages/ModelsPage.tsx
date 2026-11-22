import ModelWorkspace from "../ModelWorkspace";
import { useWorkspace } from "../workspace/WorkspaceContext";

export default function ModelsPage() {
  const { token } = useWorkspace();
  return <ModelWorkspace token={token} />;
}
