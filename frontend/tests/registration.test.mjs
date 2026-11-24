import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/registration.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { describeTransform, summarize, VIEW_LABELS } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const base = { mode: "rigid", success: true, reason: null, ncc_before: 0.31, ncc_after: 0.94, low_confidence: false,
  parameters: { translation_x_px: -9.4, translation_y_px: 6.0, rotation_deg: -3.0, scale_x: 1, scale_y: 1 } };

test("the transform is described in plain directions", () => {
  assert.deepEqual(describeTransform(base), ["Shift: 9.4 px left, 6.0 px down", "Rotation: 3.00° clockwise"]);
  const none = describeTransform({ mode: "affine", parameters: { translation_x_px: 0, translation_y_px: 0, rotation_deg: 0, scale_x: 0.952, scale_y: 0.951 } });
  assert.equal(none[0], "Shift: none, none");
  assert.equal(none[1], "Rotation: none");
  assert.equal(none[2], "Scale: 0.952 horizontal, 0.951 vertical");
  assert.ok(describeTransform({ mode: "rigid", parameters: { ...base.parameters, rotation_deg: 2.5 } })[1].endsWith("counter-clockwise"));
});

test("the summary never claims an alignment that did not happen", () => {
  assert.equal(summarize(base).tone, "good");
  assert.ok(summarize(base).label.includes("0.31") && summarize(base).label.includes("0.94"));
  assert.equal(summarize({ ...base, low_confidence: true }).tone, "warn");
  const failed = summarize({ ...base, success: false, reason: "They may show different projections" });
  assert.equal(failed.tone, "none");
  assert.ok(failed.label.includes("different projections"));
  assert.ok(summarize({ ...base, success: false, reason: null }).label.length > 10);
});

test("all three overlay views are labelled, and the panel is mounted on the analysis page for cases with two images", () => {
  assert.deepEqual(Object.keys(VIEW_LABELS), ["blend", "checker", "aligned"]);
  const workspace = fs.readFileSync(new URL("../src/pages/AnalysisWorkspace.tsx", import.meta.url), "utf8");
  assert.ok(workspace.includes("<ImageRegistrationPanel token={token} images={selected.images} imageId={selectedImage.id} />"));
  assert.ok(workspace.includes("(selected.images?.length ?? 0) > 1"));
  const panel = fs.readFileSync(new URL("../src/ImageRegistrationPanel.tsx", import.meta.url), "utf8");
  assert.ok(panel.includes("/registration?reference_id="));
});
