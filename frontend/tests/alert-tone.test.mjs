import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/alertTone.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { alertTone } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("every alert level the API returns has a deliberate colour", () => {
  assert.equal(alertTone("critical"), "error");
  assert.equal(alertTone("high"), "error");
  assert.equal(alertTone("medium"), "warning");
  assert.equal(alertTone("low"), "info");
  assert.equal(alertTone("informational"), "info");
});

test("unknown or missing levels stay neutral and never throw", () => {
  assert.equal(alertTone(undefined), "info");
  assert.equal(alertTone(null), "info");
  assert.equal(alertTone("surprise"), "info");
});

test("the notification bell uses the helper instead of its own level table", () => {
  const bell = fs.readFileSync(new URL("../src/NotificationBell.tsx", import.meta.url), "utf8");
  assert.ok(bell.includes("alertTone(item.alert_level)"));
  assert.ok(!bell.includes('critical:"error"'));
});
