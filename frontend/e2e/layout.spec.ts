import { expect, test } from "@playwright/test";
import { apiToken, signIn, syntheticPng } from "./helpers";

test("pages fit the screen and offer a skip link", async ({ page, request }) => {
  const token = await apiToken(request, "researcher");
  const headers = { Authorization: `Bearer ${token}` };
  const caseRecord = await (await request.post("/api/cases", { headers, data: { case_code: `E2E-LAYOUT-${Date.now()}`, modality: "XCA", anatomy: "coronary" } })).json();
  const image = await (await request.post(`/api/cases/${caseRecord.id}/images`, { headers,
    multipart: { file: { name: "synthetic-angiogram.png", mimeType: "image/png", buffer: syntheticPng() } } })).json();

  await signIn(page, "researcher");
  for (const path of ["/overview", "/cases", `/cases?case_id=${caseRecord.id}`, "/account", "/models", `/analysis?case_id=${caseRecord.id}&image_id=${image.id}`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
  }
  // From a fresh load, the first Tab stop is the skip link.
  await page.goto("/overview");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});

test("mobile navigation stays compact and leaves the workspace visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "researcher");
  await page.goto("/analysis");
  await page.waitForLoadState("networkidle");

  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  const content = page.locator("#main-content");
  await expect(sidebar).toBeVisible();
  await expect(content).toBeVisible();
  // The fixed mobile header is about 130 px tall; the compact navigation rail
  // must keep the analysis heading inside the first 240 px of the viewport.
  expect((await sidebar.boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(90);
  expect((await content.boundingBox())?.y ?? Infinity).toBeLessThanOrEqual(240);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
