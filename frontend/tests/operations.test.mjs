import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/operations.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { formatBytes, memoryStatus, overallLevel, levelRank } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("byte counts are readable and tolerate missing values", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1073741824), "1.0 GB");
  assert.equal(formatBytes(null), "unknown");
  assert.equal(formatBytes(undefined), "unknown");
  assert.equal(formatBytes(-5), "0 B");
});

test("memory status flags use above the warning threshold and explains a missing limit", () => {
  const near = memoryStatus({ used_bytes: 900 * 1048576, limit_bytes: 1024 * 1048576, percent: 88 }, 85);
  assert.equal(near.level, "error");
  assert.ok(near.label.includes("88%") && near.label.includes("1.0 GB"));
  assert.equal(memoryStatus({ used_bytes: 100, limit_bytes: 1000, percent: 10 }, 85).level, "info");
  const none = memoryStatus({ used_bytes: 5 * 1048576, limit_bytes: null, percent: null }, 85);
  assert.equal(none.level, "info");
  assert.ok(none.label.includes("no container limit"));
});

test("the overall banner shows the highest level that is firing", () => {
  assert.equal(overallLevel([]), "info");
  assert.equal(overallLevel([{ level: "warning" }, { level: "critical" }, { level: "error" }]), "critical");
  assert.ok(levelRank("error") > levelRank("warning"));
});

test("the Operations page is reachable only for administrators and listed in the sidebar and routes", () => {
  const perms = fs.readFileSync(new URL("../src/permissions.ts", import.meta.url), "utf8");
  assert.ok(perms.includes('"audit", "operations"]'));
  assert.ok(fs.readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8").includes('operations: "/admin/operations"'));
  assert.ok(fs.readFileSync(new URL("../src/components/watermelon/macos-sidebar.tsx", import.meta.url), "utf8").includes('id: "operations"'));
  assert.ok(fs.readFileSync(new URL("../src/OperationsPanel.tsx", import.meta.url), "utf8").includes("/api/admin/operations/test-alert"));
});
