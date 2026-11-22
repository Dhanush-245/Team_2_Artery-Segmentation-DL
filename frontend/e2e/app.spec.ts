import { expect, test } from "@playwright/test";
import { apiToken, signIn, syntheticPng } from "./helpers";

test("private metadata keeps the app out of search indexes", async ({ request }) => {
  const html = await (await request.get("/overview")).text();
  expect(html).toContain('name="robots" content="noindex, nofollow"');
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /");
});

test("sections have their own URLs, titles and working back navigation", async ({ page }) => {
  await signIn(page, "researcher");
  await page.goto("/reports");
  await expect(page).toHaveTitle(/Reports · CoroVision AI/);
  await page.goto("/models");
  await expect(page).toHaveTitle(/Model Evaluation · CoroVision AI/);
  await page.goBack();
  await expect(page).toHaveURL(/\/reports$/);
});

test("the retired milestone tracker address returns to the workspace", async ({ page }) => {
  await signIn(page, "researcher");
  await page.goto("/milestones");
  await expect(page).not.toHaveURL(/\/milestones/);
  await expect(page.getByRole("button", { name: /milestone tracker/i })).toHaveCount(0);
});

test("a case with an uploaded image opens in the analysis workspace by link", async ({ page, request }) => {
  const token = await apiToken(request, "researcher");
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post("/api/cases", { headers, data: { case_code: `E2E-${Date.now()}`, modality: "XCA", anatomy: "coronary" } });
  expect(created.ok()).toBeTruthy();
  const caseRecord = await created.json();
  const upload = await request.post(`/api/cases/${caseRecord.id}/images`, { headers,
    multipart: { file: { name: "synthetic-angiogram.png", mimeType: "image/png", buffer: syntheticPng() } } });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const image = await upload.json();

  await signIn(page, "researcher");
  await page.goto(`/analysis?case_id=${caseRecord.id}&image_id=${image.id}`);
  await expect(page.getByRole("heading", { name: /coronary analysis/i })).toBeVisible();
  await expect(page.locator(".workbench-selectors select").first()).toHaveValue(caseRecord.id);
  await expect(page.locator(".workbench-selectors select").nth(1)).toHaveValue(image.id);
});

test("a viewer cannot open administration", async ({ page }) => {
  await signIn(page, "viewer");
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin/);
});

test("a doctor records a caliper reference measurement", async ({ page, request }) => {
  const token = await apiToken(request, "doctor");
  const headers = { Authorization: `Bearer ${token}` };
  const caseRecord = await (await request.post("/api/cases", { headers, data: { case_code: `E2E-CAL-${Date.now()}`, modality: "XCA", anatomy: "coronary" } })).json();
  const image = await (await request.post(`/api/cases/${caseRecord.id}/images`, { headers,
    multipart: { file: { name: "synthetic-angiogram.png", mimeType: "image/png", buffer: syntheticPng() } } })).json();

  await signIn(page, "doctor");
  await page.goto(`/analysis?case_id=${caseRecord.id}&image_id=${image.id}`);
  await page.getByRole("button", { name: "Measure" }).click();
  const layer = page.locator(".caliper-layer");
  await expect(layer).toBeVisible();
  await layer.scrollIntoViewIfNeeded();
  const box = (await layer.boundingBox())!;
  const side = Math.min(box.width, box.height);
  const at = (x: number, y: number) => ({ x: box.x + (box.width - side) / 2 + (x / 512) * side, y: box.y + (box.height - side) / 2 + (y / 512) * side });
  for (const [x, y] of [[250, 250], [250, 256], [120, 180], [120, 196]]) { const p = at(x, y); await page.mouse.click(p.x, p.y); }
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByRole("table", { name: /saved reference measurements/i })).toContainText("L1");
});

test("the Explainable AI research page lists only this user's evidence and states its limits", async ({ page }) => {
  await signIn(page, "researcher");
  await page.goto("/xai");
  await expect(page.getByRole("heading", { name: "Explainable AI", level: 2 })).toBeVisible();
  await expect(page).toHaveTitle(/Explainable AI · CoroVision AI/);
  await expect(page.getByText("Only cases you can open are counted.")).toBeVisible();
  await expect(page.getByText(/volumetric attribution is not implemented/)).toBeVisible();
});
