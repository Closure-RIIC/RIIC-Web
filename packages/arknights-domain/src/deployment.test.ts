import assert from "node:assert/strict";
import test from "node:test";

import {
  appDeploymentEnvironment,
  areRequestRateLimitsEnabled,
  isDebugToolsFeatureEnabled,
  isSklandFeatureEnabled,
} from "./deployment.ts";

test("production enables Skland only when explicitly requested", () => {
  const enabledEnvironment = {
    APP_DEPLOYMENT_ENV: "production",
    SKLAND_FEATURE_ENABLED: "1",
    NODE_ENV: "production",
  } as const;
  assert.equal(appDeploymentEnvironment(enabledEnvironment), "production");
  assert.equal(isSklandFeatureEnabled(enabledEnvironment), true);
  assert.equal(isSklandFeatureEnabled({
    ...enabledEnvironment,
    SKLAND_FEATURE_ENABLED: "0",
  }), false);
  assert.equal(isSklandFeatureEnabled({
    APP_DEPLOYMENT_ENV: "production",
    NODE_ENV: "production",
  }), false);
});

test("production forces debug tools off and rate limits on", () => {
  const environment = {
    APP_DEPLOYMENT_ENV: "production",
    BETA_DEBUG_TOOLS_ENABLED: "1",
    BETA_RATE_LIMIT_ENABLED: "0",
    NODE_ENV: "production",
  } as const;
  assert.equal(isDebugToolsFeatureEnabled(environment), false);
  assert.equal(areRequestRateLimitsEnabled(environment), true);
});

test("development deployment can manage debug tools and rate limits", () => {
  const environment = {
    APP_DEPLOYMENT_ENV: "development",
    BETA_DEBUG_TOOLS_ENABLED: "1",
    BETA_RATE_LIMIT_ENABLED: "0",
    NODE_ENV: "production",
  } as const;
  assert.equal(isDebugToolsFeatureEnabled(environment), true);
  assert.equal(areRequestRateLimitsEnabled(environment), false);
});

test("development deployment keeps Skland unless explicitly disabled", () => {
  assert.equal(isSklandFeatureEnabled({
    APP_DEPLOYMENT_ENV: "development",
    SKLAND_FEATURE_ENABLED: "1",
    NODE_ENV: "production",
  }), true);
  assert.equal(isSklandFeatureEnabled({
    APP_DEPLOYMENT_ENV: "development",
    SKLAND_FEATURE_ENABLED: "0",
    NODE_ENV: "production",
  }), false);
});

test("an unlabelled production build fails closed", () => {
  assert.equal(isSklandFeatureEnabled({
    APP_DEPLOYMENT_ENV: undefined,
    SKLAND_FEATURE_ENABLED: "1",
    NODE_ENV: "production",
  }), false);
});

test("local development remains compatible by default", () => {
  assert.equal(appDeploymentEnvironment({
    APP_DEPLOYMENT_ENV: undefined,
    SKLAND_FEATURE_ENABLED: undefined,
    NODE_ENV: "development",
  }), "local");
  assert.equal(isSklandFeatureEnabled({
    APP_DEPLOYMENT_ENV: undefined,
    SKLAND_FEATURE_ENABLED: undefined,
    NODE_ENV: "development",
  }), true);
});
