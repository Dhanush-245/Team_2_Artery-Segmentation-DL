import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/comparison.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { chartMetrics, formatMetric, barWidth, METRIC_LABELS } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const comparison = JSON.parse(fs.readFileSync(new URL("../../ml/releases/model_comparison_20261124.json", import.meta.url), "utf8"));

test("charts only offer 0 to 1 metrics; distances and counts stay in the table", () => {
  const artery = comparison.tasks.find(task => task.id === "artery_2d");
  const keys = chartMetrics(artery);
  assert.ok(keys.includes("dice") && keys.includes("iou"));
  assert.ok(!keys.includes("hd95") && !keys.includes("assd"));
  const stenosis = comparison.tasks.find(task => task.id === "stenosis_2d");
  assert.ok(!chartMetrics(stenosis).includes("fp_per_image"));
});

test("values are formatted for their unit and bars stay inside the track", () => {
  assert.equal(formatMetric("dice", 0.82727), "0.8273");
  assert.equal(formatMetric("hd95", 46.53), "46.5");
  assert.equal(formatMetric("fp_per_image", 1.245), "1.25");
  assert.equal(formatMetric("dice", undefined), "—");
  assert.equal(barWidth(0.5), "50%");
  assert.equal(barWidth(1.7), "100%");
  assert.equal(barWidth(undefined), "0%");
});

test("every metric key in the data has a readable label", () => {
  for (const task of comparison.tasks) for (const key of task.metric_keys) assert.ok(METRIC_LABELS[key], key);
});

test("the Model Evaluation page shows the comparison section and the component reads the API", () => {
  const page = fs.readFileSync(new URL("../src/ModelWorkspace.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("<ArchitectureComparison token={token} />"));
  const component = fs.readFileSync(new URL("../src/ArchitectureComparison.tsx", import.meta.url), "utf8");
  assert.ok(component.includes("/api/models/comparison"));
});
