import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir:"./e2e", testMatch:["agent-billing.spec.ts", "agent-resources.spec.ts"],workers:1,timeout:180_000,
  use:{...devices["Desktop Chrome"],baseURL:"http://127.0.0.1:5198",trace:"retain-on-failure",screenshot:"only-on-failure"},
  webServer:{command:"node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 5198",url:"http://127.0.0.1:5198",reuseExistingServer:false,timeout:120_000,
    env:{RIIC_NEXT_DIST_DIR:".next",RIIC_E2E:"1",DATABASE_URL:process.env.AUTH_INTEGRATION_DATABASE_URL??"",BETTER_AUTH_SECRET:"isolated-agent-billing-e2e-secret-20261012",BETTER_AUTH_URL:"http://127.0.0.1:5198",APP_DEPLOYMENT_ENV:"development",AGENT_ACCESS_MODE:"admin",BILLING_ACCESS_MODE:"admin",AGENT_GATEWAY_ENABLED:"1",AGENT_GATEWAY_KEY:"isolated-test-gateway",AGENT_GATEWAY_URL:"http://127.0.0.1:3498/v1",BETA_RATE_LIMIT_ENABLED:"0"}},
});
