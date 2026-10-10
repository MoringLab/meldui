import { defineConfig } from "@playwright/test";
/** Measurement layers (layout, behavior). They record results; the scorecard applies the targets. */
export default defineConfig({
  testDir: "./tests/eval",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  use: { baseURL: "http://127.0.0.1:5173" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm --filter @engine/playground dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
