import { Card } from "../components/prismui/card";
import { MILESTONES, MILESTONE_SOURCES, STATUS_LABEL, type RecordedStatus } from "../milestoneStatus";
import { SECTION_META } from "../sectionMeta";
import { canOpenSection } from "../permissions";
import { useWorkspace } from "../workspace/WorkspaceContext";

function StatusBadge({ status, recorded }: { status: RecordedStatus; recorded?: string }) {
  const { label, tone } = STATUS_LABEL[status];
  return <span className={`cv-status cv-status-${tone}`} title={recorded ? `Recorded: ${recorded}` : undefined}>{label}</span>;
}

/** /milestones: the brief's four milestones, their tasks and recorded acceptance, linked to the delivering screen. */
export default function MilestonesPage() {
  const { user, setActiveView } = useWorkspace();
  const counts = MILESTONES.flatMap((milestone) => milestone.tasks).reduce<Record<string, number>>((total, task) => {
    const { label } = STATUS_LABEL[task.status];
    return { ...total, [label]: (total[label] || 0) + 1 };
  }, {});
  return <section className="cv-milestones" aria-labelledby="milestones-title">
    <div className="page-heading">
      <div><p className="eyebrow">DELIVERY TRACKING</p><h2 id="milestones-title">Milestone tracker</h2></div>
      <span className="stage-badge">Research demonstration</span>
    </div>
    <p className="muted">Statuses are copied from the recorded acceptance reports, not computed by the app. "Verified" means PASS for the scope stated in the report, usually local; it is not clinical validation.</p>
    <ul className="cv-milestone-counts" aria-label="Task status totals">
      {Object.entries(counts).map(([label, count]) => <li key={label}><strong>{count}</strong> {label}</li>)}
    </ul>
    {MILESTONES.map((milestone) => <Card className="panel cv-milestone" key={milestone.number}>
      <header>
        <div><p className="eyebrow">MILESTONE {milestone.number} · {milestone.weeks.toUpperCase()}</p><h3>{milestone.title}</h3></div>
        <StatusBadge status={milestone.overall} />
      </header>
      <p className="caption">{milestone.overallNote}</p>
      <div className="table-scroll"><table>
        <caption className="sr-only">Milestone {milestone.number} tasks</caption>
        <thead><tr><th scope="col">ID</th><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Scope or remaining check</th><th scope="col">Screen</th><th scope="col">Source</th></tr></thead>
        <tbody>{milestone.tasks.map((task) => {
          const source = MILESTONE_SOURCES[task.source];
          const reachable = task.screen && canOpenSection(task.screen, user.role, user.permissions);
          return <tr key={task.id}>
            <th scope="row">{task.id}</th>
            <td>{task.title}</td>
            <td><StatusBadge status={task.status} recorded={task.recorded} />{task.recorded !== task.status && <small className="cv-recorded">{task.recorded}</small>}</td>
            <td>{task.scope}</td>
            <td>{task.screen ? reachable
              ? <button type="button" className="cv-link-button" onClick={() => setActiveView(task.screen!)}>{SECTION_META[task.screen].title} →</button>
              : <span className="muted">{SECTION_META[task.screen].title} (not available to your role)</span>
              : <span className="muted">Backend / operations</span>}</td>
            <td><code title={`Recorded ${source.recorded}`}>{source.file.replace("reports/", "")}</code></td>
          </tr>;
        })}</tbody>
      </table></div>
    </Card>)}
    <p className="footer-note">Sources: {Object.values(MILESTONE_SOURCES).map((source) => `${source.file} (${source.recorded})`).join(" · ")}.</p>
  </section>;
}
