import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/volumeSections.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { VOLUME_SECTIONS, activeSection, sourceChecklist } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("twelve sections in workflow order with unique anchors", () => {
  assert.equal(VOLUME_SECTIONS.length, 12);
  assert.equal(new Set(VOLUME_SECTIONS.map(s => s.id)).size, 12);
  assert.equal(VOLUME_SECTIONS[0].label, "Overview");
  assert.equal(VOLUME_SECTIONS[11].label, "Reports & exports");
});

test("scroll-spy picks the last section that has reached the reading line", () => {
  assert.equal(activeSection({}), "v3d-overview");
  assert.equal(activeSection({ "v3d-overview": -900, "v3d-source": -300, "v3d-viewer": 500 }), "v3d-source");
  assert.equal(activeSection({ "v3d-overview": -50, "v3d-source": 120 }), "v3d-source");
});

test("source checklist states only what the run recorded", () => {
  const ok = sourceChecklist({ input_kind: "medical_study", source_shape: [512, 512, 321], preprocessing: { version: "v2", roi: { fov_mm: 160 } }, hasSourceGridMask: true });
  assert.ok(ok.every(c => c.status !== "warn"));
  const bad = sourceChecklist({ input_kind: "synthetic_fixture", source_shape: [], hasSourceGridMask: false });
  assert.equal(bad.filter(c => c.status === "warn").length, 3);
});

test("every section anchor exists on the 3D case page", () => {
  const page = ["VolumeInference", "VolumeSectionNav", "VolumeLinkedViewer", "VolumeMaskReviewPanel", "VolumeReferenceMetrics"]
    .map(name => fs.readFileSync(new URL(`../src/${name}.tsx`, import.meta.url), "utf8")).join("\n");
  for (const { id } of VOLUME_SECTIONS) assert.ok(page.includes(`id="${id}"`), id);
});

test("saved source validation never treats generic guidance as a passed check", () => {
  const run = { input_kind: "medical_study", source_shape: [32, 32, 32], hasSourceGridMask: true };
  assert.equal(sourceChecklist(run).find(c => c.label === "Saved source validation").status, "info");
  assert.equal(sourceChecklist({ ...run, validation: { status: "checked", detail: "Matching saved source" } }).find(c => c.label === "Saved source validation").status, "ok");
  assert.equal(sourceChecklist({ ...run, validation: { status: "failed", detail: "Hash mismatch" } }).find(c => c.label === "Saved source validation").status, "warn");
});
