import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../src/pages/XaiDashboardPage.tsx", import.meta.url), "utf8");

test("a saved 2D explanation row opens its exact case, image and run from the whole row", () => {
  assert.ok(page.includes('className="cv-row-link" onClick={() => navigate(`/analysis?case_id=${r.case_id}&image_id=${r.image_id}&run_id=${r.run_id}`)}'));
});

test("a saved 3D explanation row opens its case from the whole row", () => {
  assert.ok(page.includes('className="cv-row-link" onClick={() => navigate(`/analysis?case_id=${r.case_id}`)}'));
});
