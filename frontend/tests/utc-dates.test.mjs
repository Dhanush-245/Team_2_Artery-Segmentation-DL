import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/time.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { utcDate } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("zone-less API timestamps are read as UTC, not local time", () => {
  assert.equal(utcDate("2026-11-23T12:26:17").toISOString(), "2026-11-23T12:26:17.000Z");
  assert.equal(utcDate("2026-11-23T12:26:17.123456").getUTCHours(), 12);
});

test("timestamps that already carry a zone are not shifted", () => {
  assert.equal(utcDate("2026-11-23T12:26:17+00:00").toISOString(), "2026-11-23T12:26:17.000Z");
  assert.equal(utcDate("2026-11-23T17:56:17+05:30").toISOString(), "2026-11-23T12:26:17.000Z");
  assert.equal(utcDate("2026-11-23T12:26:17Z").toISOString(), "2026-11-23T12:26:17.000Z");
});

test("missing values give an invalid date instead of throwing", () => {
  assert.ok(Number.isNaN(utcDate(null).getTime()));
  assert.ok(Number.isNaN(utcDate(undefined).getTime()));
});

test("the case workflow shows the report approval time with the UTC helper", () => {
  const workflow = fs.readFileSync(new URL("../src/CaseWorkflow.tsx", import.meta.url), "utf8");
  assert.ok(workflow.includes("utcDate(caseRecord.report_approved_at)"));
  assert.ok(!workflow.includes("new Date(caseRecord.report_approved_at)"));
});
