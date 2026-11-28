import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/candidateNavigation.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { pointOnPath, positionOnPath } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const points = [[10, -5, 2], [13, -1, 2], [13, -1, 14]];
test('CPR distance maps onto saved 3D polyline across unequal segments', () => {
  assert.deepEqual(pointOnPath(points, 2.5), [11.5, -3, 2]);
  assert.deepEqual(pointOnPath(points, 11), [13, -1, 8]);
  assert.equal(positionOnPath(points, [13, -1, 8]), 11);
});
test('off-path candidate projects onto nearest segment, endpoints clamp and duplicates resolve', () => {
  assert.equal(positionOnPath(points, [15, -1, 8]), 11);
  assert.deepEqual(pointOnPath(points, -10), points[0]);
  assert.deepEqual(pointOnPath(points, 100), points[2]);
  assert.deepEqual(pointOnPath([points[0], points[0], points[1]], 2.5), [11.5,-3,2]);
  assert.equal(pointOnPath([], 3), null);
});
