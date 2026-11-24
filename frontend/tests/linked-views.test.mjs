import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/linkedViews.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const lv = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const shape = [512, 512, 321];
const [axial, coronal, sagittal] = lv.PLANES;

test("click then crosshair round-trips to the same voxel in every plane", () => {
  for (const plane of lv.PLANES) {
    const start = [100, 200, 50];
    const { fx, fy } = lv.crosshairFraction(plane, start, shape);
    assert.deepEqual(lv.positionFromClick(plane, [0, 0, 0], shape, fx, fy).filter((_, a) => a === plane.col || a === plane.row),
      start.filter((_, a) => a === plane.col || a === plane.row));
  }
});

test("a click keeps the slice index of its own plane and moves the other two planes", () => {
  const next = lv.positionFromClick(axial, [10, 20, 99], shape, 0.5, 0.25);
  assert.equal(next[2], 99);
  assert.equal(next[0], 256);
  assert.equal(next[1], Math.floor(0.75 * 512));
});

test("the server flips rows, so the top of a coronal image is the highest slice", () => {
  assert.equal(lv.positionFromClick(coronal, [0, 0, 0], shape, 0, 0)[2], 320);
  assert.equal(lv.positionFromClick(coronal, [0, 0, 0], shape, 0, 1)[2], 0);
  assert.equal(lv.positionFromClick(sagittal, [0, 0, 0], shape, 1, 0.5)[1], 511);
});

test("positions and steps stay inside the volume", () => {
  assert.deepEqual(lv.clampPosition([-4, 900, 3.6], shape), [0, 511, 4]);
  assert.equal(lv.stepAlong(axial, [1, 1, 320], shape, 5)[2], 320);
  assert.deepEqual(lv.centerPosition(shape), [256, 256, 160]);
});

test("zoom and pan are bounded", () => {
  assert.equal(lv.clampZoom(0.2), 1);
  assert.equal(lv.clampZoom(99), 8);
  assert.deepEqual(lv.clampPan({ x: 999, y: -999 }, 1, 400, 300), { x: 0, y: 0 });
  assert.deepEqual(lv.clampPan({ x: 999, y: -999 }, 2, 400, 300), { x: 200, y: -150 });
});
