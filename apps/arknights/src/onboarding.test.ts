import assert from "node:assert/strict";
import test from "node:test";

import {
  onboardingStepStatuses,
  ONBOARDING_TASK_COUNT,
  parseOnboardingVisits,
  resolveOnboardingPreference,
  shouldShowAnonymousSampleTrial,
} from "./onboarding.ts";

test("nine tasks include only known, unique visited pages", () => {
  assert.equal(ONBOARDING_TASK_COUNT, 9);
  assert.deepEqual(parseOnboardingVisits(null), []);
  assert.deepEqual(parseOnboardingVisits("broken"), []);
  assert.deepEqual(parseOnboardingVisits('{"manual":true}'), []);
  assert.deepEqual(parseOnboardingVisits('["manual","manual","calculator",null,"skill-query","settings"]'), ["manual", "skill-query", "settings"]);
});

test("onboarding preferences migrate the legacy seen marker and complete after a plan", () => {
  assert.equal(resolveOnboardingPreference(null, false), "active");
  assert.equal(resolveOnboardingPreference("1", false), "dismissed");
  assert.equal(resolveOnboardingPreference("dismissed", false), "dismissed");
  assert.equal(resolveOnboardingPreference(null, true), "completed");
  assert.equal(resolveOnboardingPreference("1", true), "dismissed");
  assert.equal(resolveOnboardingPreference("dismissed", true), "dismissed");
  assert.equal(resolveOnboardingPreference("finished", false), "finished");
  assert.equal(resolveOnboardingPreference("finished", true), "finished");
});

test("onboarding step state always points to the next unfinished action", () => {
  assert.deepEqual(onboardingStepStatuses({
    authenticated: false,
    hasPersonalBox: false,
    hasSuccessfulPlan: false,
  }), ["current", "upcoming", "upcoming"]);
  assert.deepEqual(onboardingStepStatuses({
    authenticated: true,
    hasPersonalBox: false,
    hasSuccessfulPlan: false,
  }), ["complete", "current", "upcoming"]);
  assert.deepEqual(onboardingStepStatuses({
    authenticated: true,
    hasPersonalBox: true,
    hasSuccessfulPlan: false,
  }), ["complete", "complete", "current"]);
  assert.deepEqual(onboardingStepStatuses({
    authenticated: true,
    hasPersonalBox: true,
    hasSuccessfulPlan: true,
  }), ["complete", "complete", "complete"]);
});

test("the anonymous sample trial is limited to active onboarding without a personal BOX", () => {
  assert.equal(shouldShowAnonymousSampleTrial({
    authenticated: false,
    hasPersonalBox: false,
    onboardingActive: true,
  }), true, "anonymous visitors without a personal BOX can use the trial");
  assert.equal(shouldShowAnonymousSampleTrial({
    authenticated: true,
    hasPersonalBox: false,
    onboardingActive: true,
  }), false, "signed-in visitors do not see the anonymous trial");
  assert.equal(shouldShowAnonymousSampleTrial({
    authenticated: false,
    hasPersonalBox: true,
    onboardingActive: true,
  }), false, "MAA or Skland personal data hides the anonymous trial");
  assert.equal(shouldShowAnonymousSampleTrial({
    authenticated: false,
    hasPersonalBox: false,
    onboardingActive: false,
  }), false, "completed or dismissed onboarding does not restore the trial");
});
