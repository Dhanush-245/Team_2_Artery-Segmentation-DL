import { expect, test } from "@playwright/test";
import { account, apiToken, blobFrame, signIn, syntheticPng } from "./helpers";

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
  const sections = page.getByRole("navigation", { name: "2D case sections" });
  await expect(sections.getByRole("button")).toHaveCount(12);
  await sections.getByRole("button", { name: "Image & Preprocessing" }).click();
  await expect(page.locator("#xca-preprocessing")).toHaveAttribute("open", "");
  await expect(page.locator("#xca-preprocessing")).toContainText(image.id);

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
  await page.getByRole("button", { name: "Measure", exact: true }).click();
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
  await expect(page.getByRole("heading", { name: "Saved volumetric explanations" })).toBeVisible();
});

test("unknown addresses show a page-not-found screen with a way back", async ({ page }) => {
  await signIn(page, "researcher");
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page).toHaveTitle(/Page not found/);
  await page.getByRole("link", { name: "Back to the dashboard" }).click();
  await expect(page).toHaveURL(/\/overview/);
});

test("the logo returns to the dashboard and every section has one main heading and its own description", async ({ page }) => {
  await signIn(page, "researcher");
  const descriptions = new Set<string>();
  for (const path of ["/cases", "/models", "/xai", "/reports", "/account"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
    descriptions.add((await page.locator('meta[name="description"]').getAttribute("content")) ?? "");
  }
  expect(descriptions.size).toBe(5);
  await page.getByRole("link", { name: /go to the dashboard/i }).click();
  await expect(page).toHaveURL(/\/overview/);
});

test("signing in from the /login address lands on the dashboard, not a 404", async ({ page }) => {
  const { email, password } = account("researcher");
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/overview/);
  await expect(page.getByText("Page not found")).toHaveCount(0);
});

test("an administrator sees the operations page, sends a test alert and finds it in the event log", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/operations");
  await expect(page.getByRole("heading", { level: 2, name: "Monitoring & alerts" })).toBeVisible();
  await expect(page.getByText("Current signals")).toBeVisible();
  await page.getByRole("button", { name: "Send a test alert" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Test alert sent to" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "alert_test" }).first()).toBeVisible();
});

test("non-administrators cannot open the operations page", async ({ page }) => {
  await signIn(page, "researcher");
  await page.goto("/admin/operations");
  await expect(page).toHaveURL(/\/overview/);
});

test("a case with two frames offers alignment, shows the result and switches overlay views", async ({ page, request }) => {
  const token = await apiToken(request, "researcher");
  const headers = { Authorization: `Bearer ${token}` };
  const caseRecord = await (await request.post("/api/cases", { headers, data: { case_code: `E2E-REG-${Date.now()}`, modality: "XCA", anatomy: "coronary" } })).json();
  const upload = async (name: string, buffer: Buffer) => (await request.post(`/api/cases/${caseRecord.id}/images`, { headers,
    multipart: { file: { name, mimeType: "image/png", buffer } } })).json();
  const reference = await upload("reference-frame.png", blobFrame(0, 0));
  const moving = await upload("shifted-frame.png", blobFrame(10, -6));
  await signIn(page, "researcher");
  await page.goto(`/analysis?case_id=${caseRecord.id}&image_id=${moving.id}`);
  await expect(page.getByRole("heading", { name: "Align two images of this case" })).toBeVisible();
  await expect(page.getByText(/^Aligned: image agreement rose/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Shift:/)).toBeVisible();
  const overlay = page.getByRole("img", { name: /Overlay of the selected image aligned to the reference/ });
  await expect(overlay).toBeVisible();
  await page.getByRole("button", { name: "Checkerboard" }).click();
  await expect(page.getByRole("img", { name: /Checkerboard/ })).toBeVisible();
  expect(reference.id).not.toEqual(moving.id);
});
