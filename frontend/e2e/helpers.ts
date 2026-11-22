import { readFileSync } from "node:fs";
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
