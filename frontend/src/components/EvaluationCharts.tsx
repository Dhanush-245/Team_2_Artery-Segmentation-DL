import type { ConfusionCounts, EpochMetric } from "../evaluationData";

const COLORS = ["var(--cv-accent, #0d9488)", "#d97706", "#dc2626", "#7c3aed"];

/** Dependency-free learning curve: train loss (left axis) and validation metrics (0–1, right axis). */
export function LearningCurve({ history, title }: { history: EpochMetric[]; title: string }) {
  if (!history.length) return <p>No epoch history recorded for this checkpoint.</p>;
  const W = 520, H = 200, P = 34;
  const epochs = history.map(row => row.epoch);
  const x = (e: number) => P + ((e - epochs[0]) / Math.max(1, epochs[epochs.length - 1] - epochs[0])) * (W - 2 * P);
  const loss = history.map(row => row.train_loss ?? null);
  const maxLoss = Math.max(...loss.filter((v): v is number => v != null), 1e-6);
  const valKeys = Object.keys(history[0]).filter(key => key.startsWith("val_")).slice(0, 3);
  const line = (values: (number | null | undefined)[], scale: (v: number) => number) =>
    values.map((v, i) => (v == null ? null : `${x(epochs[i]).toFixed(1)},${scale(v).toFixed(1)}`)).filter(Boolean).join(" ");
  const yLoss = (v: number) => H - P - (v / maxLoss) * (H - 2 * P);
  const yRatio = (v: number) => H - P - Math.max(0, Math.min(1, v)) * (H - 2 * P);
  const best = valKeys[0] ? history.reduce((a, b) => ((b[valKeys[0]] ?? -1) > (a[valKeys[0]] ?? -1) ? b : a)) : null;
  return (
    <figure className="cv-learning-curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: training loss and validation metrics over ${history.length} epochs`} style={{ width: "100%", maxWidth: W }}>
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="currentColor" opacity={0.25} />
        <line x1={P} y1={P} x2={P} y2={H - P} stroke="currentColor" opacity={0.25} />
        <polyline points={line(loss, yLoss)} fill="none" stroke="currentColor" strokeDasharray="4 3" strokeWidth={1.5} opacity={0.7} />
        {valKeys.map((key, i) => <polyline key={key} points={line(history.map(r => r[key]), yRatio)} fill="none" stroke={COLORS[i]} strokeWidth={2} />)}
        {best && <circle cx={x(best.epoch)} cy={yRatio(best[valKeys[0]] ?? 0)} r={4} fill={COLORS[0]}><title>Best {valKeys[0]}: epoch {best.epoch}</title></circle>}
        <text x={P} y={H - 10} fontSize={10} fill="currentColor">epoch {epochs[0]}</text>
        <text x={W - P} y={H - 10} fontSize={10} fill="currentColor" textAnchor="end">epoch {epochs[epochs.length - 1]}</text>
      </svg>
      <figcaption>
        <span>— — train loss (scaled)</span>
        {valKeys.map((key, i) => <span key={key} style={{ color: COLORS[i], marginLeft: 12 }}>━ {key.replace("val_", "validation ").replace(/_/g, " ")}</span>)}
        {best && <span style={{ marginLeft: 12 }}>best {valKeys[0].replace("val_", "")} at epoch {best.epoch}: {(best[valKeys[0]] ?? 0).toFixed(4)}</span>}
      </figcaption>
    </figure>
  );
}

/** 2×2 confusion counts with derived rates; empty cells stay "not defined" rather than zero. */
export function ConfusionGrid({ counts }: { counts: ConfusionCounts }) {
  const { tp, fp, fn, tn } = counts;
  const rate = (a: number | null, b: number | null) => (a == null || b == null || a + b === 0 ? "—" : (a / (a + b)).toFixed(3));
  const cell = (label: string, value: number | null, tone: string) => (
    <td style={{ textAlign: "center", padding: "10px 14px", background: tone }}><strong>{value == null ? "not defined" : value.toLocaleString()}</strong><br /><small>{label}</small></td>
  );
  return (
    <div className="table-scroll">
      <table aria-label={`Confusion counts, ${counts.level}`}>
        <caption>{counts.level}</caption>
        <thead><tr><th /><th scope="col">Reference positive</th><th scope="col">Reference negative</th></tr></thead>
        <tbody>
          <tr><th scope="row">Predicted positive</th>{cell("true positive", tp, "rgba(22,163,74,.12)")}{cell("false positive", fp, "rgba(220,38,38,.10)")}</tr>
          <tr><th scope="row">Predicted negative</th>{cell("false negative", fn, "rgba(220,38,38,.10)")}{cell("true negative", tn, "rgba(22,163,74,.12)")}</tr>
        </tbody>
      </table>
      <p className="caption">Precision {rate(tp, fp)} · Recall / sensitivity {rate(tp, fn)} · Specificity {rate(tn, fp)}</p>
    </div>
  );
}
