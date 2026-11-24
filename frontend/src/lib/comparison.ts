export type ComparisonRow = {
  name: string; family: string; status: string; input_px: number | null; epochs: number | null;
  aggregation: string; metrics: Record<string, number>; note: string; source: string;
};
export type ComparisonTask = { id: string; title: string; dataset: string; split: string; metric_keys: string[]; rows: ComparisonRow[] };
export type Comparison = {
  rules: string[]; status_labels: Record<string, string>; tasks: ComparisonTask[]; not_implemented: string[];
};

export const METRIC_LABELS: Record<string, string> = {
  dice: "Dice", iou: "IoU", precision: "Precision", recall: "Recall", specificity: "Specificity",
  hd95: "HD95 (px)", assd: "ASSD (px)", official_f1: "Official F1", fp_per_image: "False positives / image",
  multiscale_mean_dice: "Multiscale mean Dice",
};

/** Distances and counts are shown in the table only; the bar chart needs values on a 0 to 1 scale. */
const NOT_BARS = new Set(["hd95", "assd", "fp_per_image"]);

export function chartMetrics(task: ComparisonTask): string[] {
  return task.metric_keys.filter((key) => !NOT_BARS.has(key) && task.rows.some((row) => key in row.metrics));
}

export function formatMetric(key: string, value: number | undefined): string {
  if (value === undefined) return "—";
  if (key === "fp_per_image") return value.toFixed(2);
  return NOT_BARS.has(key) ? value.toFixed(1) : value.toFixed(4);
}

export function barWidth(value: number | undefined): string {
  return `${Math.min(100, Math.max(0, (value ?? 0) * 100))}%`;
}
