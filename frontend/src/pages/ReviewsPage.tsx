import ReviewQueue from "../ReviewQueue";
import { useWorkspace } from "../workspace/WorkspaceContext";
import AnalysisWorkspace from "./AnalysisWorkspace";

export default function ReviewsPage() {
  const { caseList, reviewWorkspace, setReviewWorkspace, selectCase } = useWorkspace();
  if (reviewWorkspace) return <AnalysisWorkspace reviewMode />;
  return <ReviewQueue cases={caseList.cases} onOpen={(id) => { selectCase(id); setReviewWorkspace(true); }} />;
}
