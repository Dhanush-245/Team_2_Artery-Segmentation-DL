import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(new URL("../src/reviewLabels.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { reviewLabels } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
test("clinician form uses clinician decision and review labels", () => {
  const labels = reviewLabels("clinician");
  assert.equal(labels.decision, "Clinician’s decision");
  assert.equal(labels.submit, "Record clinician review");
  assert.ok(Object.values(labels).every(label => !label.includes("Doctor")));
});
test("doctor keeps doctor-specific labels; admin remains neutral", () => {
  assert.equal(reviewLabels("doctor").decision, "Doctor’s decision");
  assert.equal(reviewLabels("doctor").title, "Doctor review and decision");
  assert.equal(reviewLabels("admin").decision, "Reviewer’s decision");
});
