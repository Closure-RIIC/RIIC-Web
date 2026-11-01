import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5184";
const webServerPort = new URL(baseURL).port || "80";
const releaseDirectory = process.env.PLAYWRIGHT_RELEASE_DIR;
const softwareGpuSpecs = ["plush-*.spec.ts", "agent-motion.spec.ts", "agent-personas.spec.ts", "agent-workbench.spec.ts"];

export default defineConfig({
  testDir: "./e2e",
  // These suites require their dedicated authenticated server configuration.
  testIgnore: ["production-profile.spec.ts", "agent-billing.spec.ts", "agent-resources.spec.ts", "tanstack-*.spec.ts"],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  expect: {
    timeout: process.env.CI ? 10_000 : 5_000,
  },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: ["production-profile.spec.ts", "agent-billing.spec.ts", "agent-resources.spec.ts", "tanstack-*.spec.ts", ...softwareGpuSpecs],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-plush",
      testMatch: softwareGpuSpecs,
      // Full-quality fur uses software WebGL in CI. Two simultaneous galleries
      // contend for the same CPU renderer and turn idle waits into load tests.
      // Keep every visual assertion while serializing GPU-heavy cases per shard.
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      // WebKit is consistently slower when hydrating the full restored schedule
      // and completing the multi-account flow on Windows CI/dev machines.
      timeout: 90_000,
    },
  ],
  webServer: {
    command: releaseDirectory
      ? `node scripts/start-standalone.mjs --hostname 127.0.0.1 --port ${webServerPort}`
      : `npm run dev -- --host 127.0.0.1 --port ${webServerPort}`,
    cwd: releaseDirectory,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      RIIC_E2E: "1",
      APP_DEPLOYMENT_ENV: "development",
      // Use the actual browser origin for signed session cookies and CSRF checks.
      BETTER_AUTH_URL: baseURL,
      ACCOUNT_CLOUD_SYNC_ENABLED: "1",
      // Existing interaction fixtures exercise the future public rollout.
      // The production-profile suite separately tests the admin boundary.
      AGENT_ACCESS_MODE: "public",
      BILLING_ACCESS_MODE: "public",
      BETA_RATE_LIMIT_ENABLED: "0",
      BETA_DEBUG_TOOLS_ENABLED: "0",
    },
  },
});
