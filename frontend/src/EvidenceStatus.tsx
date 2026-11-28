import { useEffect, useState } from 'react';
import { request } from './api';
type Metric = { mean: number | null; support: number; bootstrap_mean_ci95: number[] | null };
type Evidence = { updated_at: string; external_evaluation: { title: string; cases: number; checkpoint_epoch: number; checkpoint_sha256: string; grid: string; limitations: string[]; cohorts: Record<string, { cases: number; metrics: Record<string, Metric> }> }; acceptance: { id: string; title: string; status: string; detail: string }[]; development_evaluation?: { title: string; dataset: string; split: string; model: string; epochs: number; input_px: number; aggregation: string; metrics: Record<string, number>; note: string; limitation: string } };
const value = (n: number | null | undefined) => n == null ? 'Not available' : n.toFixed(4);
export default function EvidenceStatus({ token, compact = false }: { token: string; compact?: boolean }) {
  const [data, setData] = useState<Evidence | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; setData(null); setError(''); request<Evidence>('/api/models/evidence-status', token).then(d => { if (active) setData(d); }).catch((e: Error) => { if (active) setError(e.message); }); return () => { active = false; }; }, [token]);
  if (error) return <p className="message error" role="alert">Evaluation evidence could not be loaded: {error}</p>;
  if (!data) return <p role="status">Loading recorded evaluation evidence…</p>;
  const e = data.external_evaluation;
  const dev = data.development_evaluation;
  const devLabels: Record<string, string> = { dice: 'DICE', recall: 'RECALL', multiscale_mean_dice: 'MULTISCALE MEAN DICE' };
  return <section className="evidence-status" aria-label="External evaluation and acceptance status">
    {dev && <><header className="evidence-heading"><div><p className="eyebrow">3D CTA · DEVELOPMENT VALIDATION</p><h3>{dev.title}</h3><p className="caption">{dev.split} · {dev.model} · epoch {dev.epochs} · {dev.input_px}-voxel prepared grid</p></div><span className="stage-badge">Research evidence</span></header>
    <dl className="evidence-metrics">{Object.entries(dev.metrics).map(([key, v]) => <div key={key}><dt>{devLabels[key] ?? key.replaceAll('_', ' ').toUpperCase()}</dt><dd>{value(v)}</dd><small>{dev.aggregation}</small></div>)}</dl>
    <p className="evidence-caution">{dev.limitation}</p></>}
    <header className="evidence-heading"><div><p className="eyebrow">3D CTA · EXTERNAL COHORT</p><h3>{e.title}</h3><p className="caption">{e.cases} expert-reference pairs · epoch {e.checkpoint_epoch} · native CT grid · recorded {data.updated_at}</p></div><span className="stage-badge">Research evidence</span></header>
    <dl className="evidence-metrics">{['dice', 'iou', 'hd95', 'assd'].map(key => <div key={key}><dt>{key.toUpperCase()}{['hd95', 'assd'].includes(key) ? ' (mm)' : ''}</dt><dd>{value(e.cohorts.All.metrics[key].mean)}</dd><small>{e.cohorts.All.metrics[key].support}/40 cases</small></div>)}</dl>
    <p className="evidence-caution">Limited external generalization. One empty final prediction is retained as Dice/IoU 0; its surface distances are undefined. These cohort means are separate from an individual case’s metrics.</p>
    {!compact && <><div className="table-scroll"><table><caption>Native-grid means by cohort; distance support excludes the empty prediction</caption><thead><tr><th scope="col">Cohort</th><th scope="col">Cases</th><th scope="col">Dice</th><th scope="col">IoU</th><th scope="col">HD95 (mm)</th><th scope="col">ASSD (mm)</th><th scope="col">Distance support</th></tr></thead><tbody>{Object.entries(e.cohorts).map(([name, c]) => <tr key={name}><th scope="row">{name}</th><td>{c.cases}</td>{['dice', 'iou', 'hd95', 'assd'].map(k => <td key={k}>{value(c.metrics[k].mean)}</td>)}<td>{c.metrics.hd95.support}/{c.cases}</td></tr>)}</tbody></table></div>
      <details><summary>Protocol, uncertainty and limitations</summary><p>Frozen checkpoint <code>{e.checkpoint_sha256}</code>. Grid: {e.grid}. No retraining or threshold tuning.</p><ul>{e.limitations.map(x => <li key={x}>{x}</li>)}</ul><p>95% bootstrap intervals for the overall mean:</p><ul>{['dice', 'iou', 'hd95', 'assd'].map(k => <li key={k}>{k.toUpperCase()}: {e.cohorts.All.metrics[k].bootstrap_mean_ci95?.map(x => x.toFixed(4)).join(' – ') ?? 'Not available'}{['hd95', 'assd'].includes(k) ? ' mm' : ''}</li>)}</ul></details>
      <div className="evidence-heading"><div><h3>Overall acceptance and remaining work</h3><p className="caption">Software verification, scientific validity and hosted operations have separate outcomes.</p></div></div><div className="acceptance-grid">{data.acceptance.map(a => <article key={a.id}><span className="stage-badge">{a.status}</span><h4>{a.title}</h4><p>{a.detail}</p></article>)}</div></>}
  </section>;
}
