import { expect, test } from "@playwright/test";
import { apiToken, signIn, syntheticPng } from "./helpers";

test("2D history shows the viewed run and reports can be saved and downloaded in place", async ({ page, request }) => {
  test.setTimeout(180_000);
  const token = await apiToken(request, "researcher");
  const headers = { Authorization: `Bearer ${token}` };
  const caseRecord = await (await request.post("/api/cases", { headers, data: { case_code: `E2E-REP-${Date.now()}`, modality: "XCA", anatomy: "coronary" } })).json();
  const image = await (await request.post(`/api/cases/${caseRecord.id}/images`, { headers,
    multipart: { file: { name: "synthetic-angiogram.png", mimeType: "image/png", buffer: syntheticPng() } } })).json();
  const job = await (await request.post(`/api/images/${image.id}/analysis/jobs`, { headers, data: { idempotency_key: `e2e-${Date.now()}` } })).json();
  await expect.poll(async () => (await (await request.get(`/api/analysis/jobs/${job.id}`, { headers })).json()).status, { timeout: 150_000 }).toBe("completed");

  await signIn(page, "researcher");
  await page.goto(`/analysis?case_id=${caseRecord.id}&image_id=${image.id}`);
  const history = page.locator("#xca-history");
  await history.scrollIntoViewIfNeeded();
  await expect(history.getByRole("heading", { name: "Analysis history" })).toBeVisible();
  const row = history.locator(".history-row").first();
  await expect(row).toHaveAttribute("aria-current", "true");
  await row.getByRole("button").click();
  await expect(page.locator("#xca-viewer")).toBeInViewport();

  const reports = page.locator("#xca-reports");
  await reports.scrollIntoViewIfNeeded();
  const before = await reports.locator(".analysis-report-list li").count();
  await reports.getByRole("button", { name: /save new report version/i }).click();
  await expect(reports.locator(".analysis-report-list li")).toHaveCount(before + 1);
  const download = page.waitForEvent("download");
  await reports.locator(".analysis-report-list li").first().getByRole("button", { name: "JSON" }).click();
  expect((await download).suggestedFilename()).toMatch(/research-v\d+\.json$/);
});

test("Explainable AI dashboard offers check summary, reading guide and inventory filters", async ({ page }) => {
  await signIn(page, "researcher");
  await page.goto("/xai");
  await expect(page.getByRole("heading", { name: "Sanity-check outcomes across saved records" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What each method and check means" })).toBeVisible();
  await expect(page.getByPlaceholder("Filter by case code")).toBeVisible();
  await expect(page.getByRole("button", { name: /download list \(csv\)/i })).toBeVisible();
});
