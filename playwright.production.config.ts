import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_PRODUCTION_BASE_URL ?? "http://127.0.0.1:5185";
const webServerPort = new URL(baseURL).port || "80";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "production-profile.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${webServerPort}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_DEPLOYMENT_ENV: "production",
      AGENT_ACCESS_MODE: "admin",
      BILLING_ACCESS_MODE: "admin",
      SKLAND_FEATURE_ENABLED: "1",
      BETA_RATE_LIMIT_ENABLED: "0",
      BETA_DEBUG_TOOLS_ENABLED: "1",
    },
  },
});
