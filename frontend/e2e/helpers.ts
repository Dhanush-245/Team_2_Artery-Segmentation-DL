import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

type Account = { backend_role: string; email: string; password: string };

export function account(role: string): Account {
  const path = process.env.DEMO_CREDENTIALS_PATH;
  if (!path) throw new Error("Set DEMO_CREDENTIALS_PATH to the seeded demo-credentials.json");
  const found = (JSON.parse(readFileSync(path, "utf8")).accounts as Account[]).find(item => item.backend_role === role);
  if (!found) throw new Error(`No seeded ${role} account`);
  return found;
}

export async function signIn(page: Page, role: string) {
  const { email, password } = account(role);
  await page.goto("/");
  await page.getByLabel(/username or email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  // The app finishes its post-sign-in route change after the navigation appears; let it settle so a following goto is not interrupted (seen in WebKit).
  await page.waitForLoadState("networkidle");
}

export async function apiToken(request: APIRequestContext, role: string) {
  const { email, password } = account(role);
  const response = await request.post("/api/auth/login", { data: { identifier: email, password } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).access_token as string;
}

/** Synthetic vessel-like image generated for tests (no patient data). */
export function syntheticPng(): Buffer {
  return readFileSync(new URL("./fixtures/synthetic-angiogram.png", import.meta.url));
}

/** Grayscale PNG of soft blobs on a gradient; (dx, dy) shifts the whole scene so two frames can be aligned. */
export function blobFrame(dx = 0, dy = 0, size = 256): Buffer {
  const blobs = [[60, 70, 18], [150, 60, 14], [200, 120, 22], [90, 170, 16], [170, 200, 20], [40, 210, 12], [120, 120, 10]];
  const raw = Buffer.alloc(size * (size + 1));
  let seed = 12345;
  for (let y = 0; y < size; y += 1) {
    raw[y * (size + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      let value = 120 + 30 * Math.sin((x - dx) / 40) + (seed % 9);
      for (const [cx, cy, radius] of blobs) value -= 90 * Math.exp(-(((x - dx - cx) ** 2 + (y - dy - cy) ** 2) / (2 * radius * radius)));
      raw[y * (size + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
