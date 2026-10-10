import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 3,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: ["chromium", "firefox", "webkit"].map((browserName) => ({
    name: browserName,
    use: { browserName: browserName as "chromium" | "firefox" | "webkit" },
  })),
  webServer: [
    {
      command: "pnpm --filter @engine/playground dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: "pnpm --filter @engine/server start",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: !process.env.CI,
      env: { OMNIROUTE_API_KEY: "", ENGINE_SANDBOX_PROVIDER: "", ENGINE_VISION: "0" },
      timeout: 30000,
    },
    {
      command: "pnpm --filter @engine/reservations start",
      url: "http://127.0.0.1:8788/health",
      reuseExistingServer: !process.env.CI,
      env: { RESERVATION_DB: "artifacts/reservations/e2e.sqlite" },
      timeout: 30000,
    },
  ],
});
