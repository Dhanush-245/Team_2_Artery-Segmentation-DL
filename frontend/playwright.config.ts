import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running CoroVision server (API + built frontend).
 * E2E_BASE_URL selects the server; DEMO_CREDENTIALS_PATH points at the seeded
 * demo-account file written by backend/seed_demo_accounts.py (never committed).
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8010",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /layout\.spec\.ts/ },
  ],
});
