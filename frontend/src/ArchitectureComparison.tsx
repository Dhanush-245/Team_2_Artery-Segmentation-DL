import { useEffect, useState } from "react";
import { request } from "./api";
import { barWidth, chartMetrics, formatMetric, METRIC_LABELS, type Comparison, type ComparisonTask } from "./lib/comparison";

function TaskComparison({ task, labels }: { task: ComparisonTask; labels: Record<string, string> }) {
  const metrics = chartMetrics(task);
  const [metric, setMetric] = useState(metrics[0] ?? "dice");
  const headingId = `arch-${task.id}`;
  return <section className="arch-task" aria-labelledby={headingId}>
    <h3 id={headingId}>{task.title}</h3>
    <p className="muted">{task.dataset} · {task.split}</p>
    <div className="arch-metric-switch" role="group" aria-label={`Metric shown in the ${task.title} chart`}>
      {metrics.map((key) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}>{METRIC_LABELS[key] ?? key}</button>)}
    </div>
    <ul className="arch-bars" aria-label={`${METRIC_LABELS[metric] ?? metric} by model`}>
      {task.rows.map((row) => {
        const value = row.metrics[metric];
        return <li key={row.name} className={`arch-bar-row status-${row.status}`}>
          <span className="arch-bar-name">{row.name}</span>
          <span className="arch-bar-track" aria-hidden="true">{value !== undefined && <span className="arch-bar-fill" style={{ width: barWidth(value) }} />}</span>
          <span className="arch-bar-value">{formatMetric(metric, value)}</span>
          <span className={`arch-badge status-${row.status}`}>{labels[row.status] ?? row.status}</span>
        </li>;
      })}
    </ul>
    <div className="table-scroll"><table>
      <caption>{task.title}: every recorded metric, with how it was measured</caption>
      <thead><tr><th>Model</th><th>Status</th><th>Input</th><th>Epochs</th>{task.metric_keys.map((key) => <th key={key}>{METRIC_LABELS[key] ?? key}</th>)}<th>Aggregation</th></tr></thead>
      <tbody>{task.rows.map((row) => <tr key={row.name}>
        <td><strong>{row.name}</strong><br /><small>{row.family}</small></td>
        <td><span className={`arch-badge status-${row.status}`}>{labels[row.status] ?? row.status}</span></td>
        <td>{row.input_px ? `${row.input_px}` : "—"}</td><td>{row.epochs ?? "—"}</td>
        {task.metric_keys.map((key) => <td key={key}>{formatMetric(key, row.metrics[key])}</td>)}
        <td><small>{row.aggregation}</small></td>
      </tr>)}</tbody>
    </table></div>
    <details className="arch-notes"><summary>Notes and sources for {task.title}</summary>
      <ul>{task.rows.map((row) => <li key={row.name}><strong>{row.name}.</strong> {row.note} <small className="muted">Source: {row.source}</small></li>)}</ul>
    </details>
  </section>;
}

/** Side-by-side evidence for the trained and trialled architectures, grouped by task and never ranked across tasks. */
export default function ArchitectureComparison({ token }: { token: string }) {
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request<Comparison>("/api/models/comparison", token)
      .then((result) => { if (active) setData(result); })
      .catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [token]);
  if (error) return <p role="alert" className="error">{error}</p>;
  if (!data) return <p role="status">Loading the architecture comparison…</p>;
  return <div className="arch-compare">
    <ul className="arch-rules">{data.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
    {data.tasks.map((task) => <TaskComparison key={task.id} task={task} labels={data.status_labels} />)}
    <p className="caption">Not implemented in this project: {data.not_implemented.join(", ")}.</p>
  </div>;
}
