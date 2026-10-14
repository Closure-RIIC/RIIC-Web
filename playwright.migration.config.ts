import { defineConfig, devices } from "@playwright/test";
const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL ?? "";
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(target.hostname) || !/test|integration/i.test(target.pathname)) throw new Error("Migration e2e requires a local, isolated test database");
}
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["tanstack-migration.spec.ts", "tanstack-auth-migration.spec.ts"],
  workers: 1,
  timeout: 45_000,
  use: { baseURL: "http://127.0.0.1:5195", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/start-standalone.mjs --hostname 127.0.0.1 --port 5195",
    url: "http://127.0.0.1:5195",
    reuseExistingServer: false,
    env: { NODE_ENV: "production", APP_DEPLOYMENT_ENV: databaseUrl ? "local" : "production", SKLAND_FEATURE_ENABLED: "1",
      DATABASE_URL: databaseUrl, DATABASE_MIGRATION_URL: "",
      BETTER_AUTH_SECRET: databaseUrl ? "migration-e2e-test-secret-not-for-production" : "",
      BETTER_AUTH_URL: databaseUrl ? "http://127.0.0.1:5195" : "",
      BETTER_AUTH_ADMIN_USER_IDS: "", BETA_PUBLIC_ORIGIN: "http://127.0.0.1:5195",
      BETA_BUSINESS_DB_ENABLED: databaseUrl ? "1" : "0", PLAN_TASK_QUEUE_ENABLED: "0" },
  },
});
