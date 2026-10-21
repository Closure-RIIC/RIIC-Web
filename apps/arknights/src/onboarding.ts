export const ONBOARDING_STORAGE_KEY = "arknights-infra-calc-beta-onboarding-v1";
export const ONBOARDING_DISMISSED_VALUE = "dismissed";
export const ONBOARDING_COMPLETED_VALUE = "completed";

export type SetupStep = "box" | "layout" | "facilities";
export type OnboardingPreference = "active" | "dismissed" | "completed";
export type OnboardingStepStatus = "current" | "complete" | "upcoming";

export function resolveOnboardingPreference(
  storedValue: string | null,
  hasSuccessfulPlan: boolean,
): OnboardingPreference {
  if (hasSuccessfulPlan || storedValue === ONBOARDING_COMPLETED_VALUE) return "completed";
  if (storedValue === "1" || storedValue === ONBOARDING_DISMISSED_VALUE) return "dismissed";
  return "active";
}

export function onboardingStepStatuses({
  authenticated,
  hasPersonalBox,
  hasSuccessfulPlan,
}: {
  authenticated: boolean;
  hasPersonalBox: boolean;
  hasSuccessfulPlan: boolean;
}): [OnboardingStepStatus, OnboardingStepStatus, OnboardingStepStatus] {
  if (hasSuccessfulPlan) return ["complete", "complete", "complete"];
  if (!authenticated) return ["current", hasPersonalBox ? "complete" : "upcoming", "upcoming"];
  if (!hasPersonalBox) return ["complete", "current", "upcoming"];
  return ["complete", "complete", "current"];
}

export function shouldShowAnonymousSampleTrial({
  authenticated,
  hasPersonalBox,
  onboardingActive,
}: {
  authenticated: boolean;
  hasPersonalBox: boolean;
  onboardingActive: boolean;
}): boolean {
  return onboardingActive && !authenticated && !hasPersonalBox;
}
