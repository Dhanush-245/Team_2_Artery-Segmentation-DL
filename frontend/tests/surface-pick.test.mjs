import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/surfacePick.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { pickSurface } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('surface picking selects the front triangle and interpolates patient coordinates', () => {
  const projected = [[0,0,0], [2,0,0], [0,2,0], [0,0,1], [2,0,2], [0,2,3]];
  const world = [[0,0,0], [2,0,0], [0,2,0], [10,20,30], [14,20,32], [10,28,34]];
  assert.deepEqual(pickSurface(projected, [[3,4,5], [0,1,2]], world, .5, .5), [11,22,31.5]);
  assert.equal(pickSurface(projected, [[0,1,2]], world, 2, 2), null);
  assert.equal(pickSurface(projected, [[0,0,1]], world, 0, 0), null);
});
