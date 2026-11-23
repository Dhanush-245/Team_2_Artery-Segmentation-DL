import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/auditLabel.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { formatAuditAction } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("audit actions become readable labels", () => {
  assert.equal(formatAuditAction("login"), "login");
  assert.equal(formatAuditAction("case_deleted"), "case deleted");
});

test("long identifiers after a colon are shortened so they cannot stretch a phone layout", () => {
  const label = formatAuditAction("automatic_measurement_saved:372775c7f47a013801f028aa11bb22cc33dd44ee55ff");
  assert.equal(label, "automatic measurement saved · 372775c7");
  assert.ok(label.length < 50);
});

test("an empty reference is ignored", () => {
  assert.equal(formatAuditAction("xai_verification_requested:"), "xai verification requested");
});

test("the activity lists use the label helper", () => {
  for (const file of ["OverviewPanel.tsx", "AccountPanel.tsx"]) {
    const text = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.ok(text.includes("formatAuditAction(item.action)"), file);
  }
});
