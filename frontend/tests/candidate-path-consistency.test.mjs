import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const inference = fs.readFileSync(new URL('../src/VolumeInference.tsx', import.meta.url), 'utf8');
const cpr = fs.readFileSync(new URL('../src/VolumeCprReview.tsx', import.meta.url), 'utf8');

test('restored candidates initialize the shared CPR path', () => {
  assert.match(inference, /if \(selectedCandidate && !focusPath\)/);
  assert.match(inference, /selectedCandidate\.path_id, false/);
});

test('choosing a candidate CPR path updates the authoritative candidate', () => {
  assert.match(inference, /candidates\.find\(candidate => candidate\.path_id === id\)/);
  assert.match(inference, /setCandidateId\(matchingCandidate\.id\)/);
});

test('an intentionally different exploratory CPR path is disclosed', () => {
  assert.match(cpr, /Different path in CPR\./);
  assert.match(cpr, /Measurements and severity still refer to/);
});
