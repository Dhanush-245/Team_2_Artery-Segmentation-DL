import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("pages fit the screen and offer a skip link", async ({ page }) => {
  await signIn(page, "researcher");
  for (const path of ["/overview", "/cases", "/milestones"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
  }
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});
