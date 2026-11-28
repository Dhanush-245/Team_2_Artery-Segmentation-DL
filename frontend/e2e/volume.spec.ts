import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiToken, signIn } from "./helpers";

/** Needs a de-identified public CTA volume and the 3D model; skipped when no volume is configured. */
const CTA = process.env.E2E_CTA_PATH ?? "";

test.describe("3D case workspace", () => {
  test.skip(!CTA || !existsSync(CTA), "Set E2E_CTA_PATH to a public coronary CTA NIfTI (.nii.gz) to run the 3D workspace test");
  test.setTimeout(240_000);

  test("linked views, candidate navigation, full screen and a versioned mask correction", async ({ page, request }) => {
    const token = await apiToken(request, "admin");
    const headers = { Authorization: `Bearer ${token}` };
    const created = await request.post("/api/cases", { headers, data: { case_code: `E2E-CTA-${Date.now()}`, modality: "CTA", anatomy: "coronary", intended_task: "volume_preparation" } });
    expect(created.ok()).toBeTruthy();
    const caseId = (await created.json()).id as string;
    const started = await request.post(`/api/cases/${caseId}/volumes/analyses`, { headers, timeout: 180_000,
      multipart: { file: { name: "cta.nii.gz", mimeType: "application/gzip", buffer: readFileSync(CTA) }, hu_confirmed: "true", research_confirmed: "true", input_kind: "medical_study" } });
    expect(started.ok(), await started.text()).toBeTruthy();
    const runId = (await started.json()).id as string;
    await expect.poll(async () => ((await (await request.get(`/api/cases/${caseId}/volumes/analyses`, { headers })).json()) as { id: string; status: string }[]).find(r => r.id === runId)?.status,
      { timeout: 180_000, intervals: [3000] }).toBe("completed");

    const root = `/api/cases/${caseId}/volumes/analyses/${runId}`;
    const targetResponse = await request.get(`${root}/locate?i=5&j=6&k=7`, {headers});
    expect(targetResponse.ok()).toBeTruthy();
    const target = await targetResponse.json();
    // Engineering fixture: keep the real saved-run geometry, but inject a candidate into the browser response only.
    // This checks candidate navigation without asserting a lesion exists in the public CTA.
    await page.route(`**${root}/analysis-detail`, async route => {
      const response = await route.fetch();
      const report = await response.json();
      const geometry = report.experimental_geometry;
      const pathId = geometry.paths[0].id;
      geometry.candidates = [{
        id: "TEST-NAVIGATION", path_id: pathId, location_ras_mm: target.ras_mm,
        minimum_diameter_mm: 1, reference_diameter_mm: 2, narrowing_percent: 50, severity: "Engineering fixture",
      }];
      await route.fulfill({ response, json: report });
    });
    await signIn(page, "admin");
    await page.goto(`/analysis?case_id=${caseId}`);
    const nav = page.getByRole("navigation", { name: "3D case sections" });
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await expect(nav.getByRole("link")).toHaveCount(12);

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(`/uploads?case_id=${caseId}`);
    await expect(page.getByRole("link", { name: "Open saved 3D analysis" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "3D case sections" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "3D measurement report" })).toHaveCount(0);
    for (const width of [1400, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.getByRole("link", { name: "Open saved 3D analysis" }).click();
    await expect(nav).toBeVisible();

    const readout = page.locator(".lv-readout");
    await expect(page.locator(".lv-panel")).toHaveCount(4);
    const axial = page.getByRole("group", { name: "Axial zoom controls" });
    const sagittal = page.getByRole("group", { name: "Sagittal zoom controls" });
    await axial.getByRole("button", { name: "Fit Axial slice" }).click();
    await sagittal.getByRole("button", { name: "Fit Sagittal slice" }).click();
    await axial.getByRole("button", { name: "Zoom in Axial" }).click();
    await expect(axial).toContainText("125%");
    await expect(sagittal).toContainText("100%");
    await axial.getByRole("button", { name: "Zoom out Axial" }).click();
    await expect(axial).toContainText("100%");

    const before = await readout.innerText();
    const box = (await page.locator(".lv-frame").first().boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await expect(readout).not.toHaveText(before);

    const afterClick = await readout.innerText();
    await page.getByRole("button", { name: /Candidate TEST-NAVIGATION/ }).first().click();
    await expect(readout).not.toHaveText(afterClick);
    await expect(readout).toContainText("Showing Candidate TEST-NAVIGATION");
    await expect(readout).toContainText("Voxel 5, 6, 7");

    const full = page.getByRole("button", { name: "Full screen" });
    await full.click();
    await expect(page.locator(".lv-viewer")).toHaveClass(/lv-full/);
    await page.getByRole("button", { name: "Exit full screen" }).click();
    await expect(page.locator(".lv-viewer")).not.toHaveClass(/lv-full/);

    await nav.getByRole("link", { name: "Segmentation" }).click();
    await page.getByRole("button", { name: "Paint crosshair voxel" }).click();
    await expect(page.getByText("Voxel 5, 6, 7 · 1 queued")).toBeVisible();
    const exclude = page.getByLabel(/Exclude component 2/);
    if (await exclude.count()) {
      await exclude.check();
      await page.getByRole("button", { name: /Save as new version/ }).click();
      await expect(page.getByText("Version 1", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".lv-readout")).toContainText("reviewer version 1");
      await expect(page.getByText("never overwritten").first()).toBeVisible();
    }
  });
});
