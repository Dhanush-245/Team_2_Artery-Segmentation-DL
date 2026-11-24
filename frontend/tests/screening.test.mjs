import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/screening.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { screeningTone, screeningCounts } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("only a flagged study is highlighted; not flagged stays neutral and indeterminate is cautionary", () => {
  assert.equal(screeningTone("abnormal_flagged"), "flag");
  assert.equal(screeningTone("not_flagged"), "neutral");
  assert.equal(screeningTone("indeterminate"), "unsure");
  assert.equal(screeningTone(undefined), "neutral");
});

test("dashboard counts tolerate missing data", () => {
  assert.deepEqual(screeningCounts(undefined), { flagged: 0, notFlagged: 0, indeterminate: 0 });
  assert.deepEqual(screeningCounts({ abnormal_flagged: 2, indeterminate: 1 }), { flagged: 2, notFlagged: 0, indeterminate: 1 });
});

test("the analysis page and dashboard show the screening label and never call a miss normal", () => {
  const workbench = fs.readFileSync(new URL("../src/AnalysisWorkbench.tsx", import.meta.url), "utf8");
  assert.ok(workbench.includes("analysis.screening.display") && workbench.includes("How this label is set"));
  const overview = fs.readFileSync(new URL("../src/OverviewPanel.tsx", import.meta.url), "utf8");
  assert.ok(overview.includes("Indeterminate screening") && overview.includes("Does not establish a normal result"));
});
