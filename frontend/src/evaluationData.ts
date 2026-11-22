export type MetricSummary = { name: string; value: number | null; unit: string; aggregation: string; definition: string };
export type ModelMetadata = { architecture: string; version: string; checkpoint_sha256: string; checkpoint_reference: string };
export type DatasetMetadata = { name: string; version: string | null; split: string; patient_independence_verified: boolean | null; subset?: string; train_images?: number | null; validation_images?: number | null; test_used_for_selection?: boolean | null; duplicates_excluded?: string[] | null };
export type EvaluationRun = {
  id: string; record_type: string; model: ModelMetadata; task: string; dataset: DatasetMetadata; dimension: string;
  sample_counts: { images: number | null; patients: number | null; studies: number | null; excluded: number | null };
  metrics: MetricSummary[]; protocol: { id: string | null; description: string; independent_final_test: boolean };
  evaluated_at: string | null; runtime_seconds: number | null; hardware: string | null;
  approval_status: string | null; reviewer_status: string | null; source: string; limitations: string[];
  training_history: EpochMetric[]; prediction_artifacts: PredictionArtifact[]; sample_evaluations: SampleEvaluation[];
  training_config?: Record<string, string | number | boolean | null> | null;
  confusion?: ConfusionCounts | null;
  operating_point?: { score_threshold?: number; mask_threshold?: number; decision?: string } | null;
  evidence_source?: { file: string; sha256: string; scope?: string; report?: string; report_sha256?: string } | null;
  recall_by_label?: Record<string, { detected: number; total: number; recall: number }>;
  frame_confusion?: ConfusionCounts | null;
  severity_agreement?: { lesions: number; measured: number; graded: number; abstention_reasons: Record<string, number>; protocol?: string } | null;
};
export type ConfusionCounts = { level: string; tp: number | null; fp: number | null; fn: number | null; tn: number | null };
/** One training epoch: `epoch`, `train_loss` and `val_*` validation metrics, flat. */
export type EpochMetric = { epoch: number; train_loss?: number | null; [key: string]: number | null | undefined };
export type PredictionArtifact = { id: string; sample_id: string; kind: string; authorized_url: string; coordinate_frame: string };
export type SampleEvaluation = { id: string; dataset: DatasetMetadata; metrics: MetricSummary[]; artifacts: PredictionArtifact[] };
export type ErrorAnalysis = { sample_id: string; category: string; matching_rule: string | null };
export type ModelApproval = { status: string; reviewer: string; reason: string; criteria_version: string; decided_at: string };
export type EvaluationReport = { runs: EvaluationRun[]; research_only: boolean; summary: Record<string, number | string | null>; capabilities: Record<string, boolean> };
export const DICE_IOU = (run: EvaluationRun) => run.metrics.filter(m => m.name === "Dice" || m.name === "IoU");
export const metricText = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "Not recorded" : value.toFixed(4);
export function comparable(a: EvaluationRun, b: EvaluationRun) {
  return a.task === b.task && a.dimension === b.dimension && a.dataset.name === b.dataset.name &&
    Boolean(a.dataset.version) && a.dataset.version === b.dataset.version && a.dataset.split === b.dataset.split &&
    Boolean(a.protocol.id) && a.protocol.id === b.protocol.id &&
    JSON.stringify(a.metrics.map(m => [m.name, m.unit, m.definition, m.aggregation])) ===
    JSON.stringify(b.metrics.map(m => [m.name, m.unit, m.definition, m.aggregation]));
}
export function filterRuns(runs: EvaluationRun[], query: string, task: string, architecture: string, sort: string) {
  return runs.filter(run => (task === "all" || run.task === task) && (architecture === "all" || run.model.architecture === architecture) &&
    [run.id, run.task, run.dataset.name, run.model.architecture, run.model.version].join(" ").toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === "dice" ? (b.metrics.find(m => m.name === "Dice")?.value ?? -1) - (a.metrics.find(m => m.name === "Dice")?.value ?? -1) : a.model.architecture.localeCompare(b.model.architecture));
}
