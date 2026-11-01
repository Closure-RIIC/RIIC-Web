import type { AppPage } from "./workbench-routes.ts";

export const ONBOARDING_STORAGE_KEY = "arknights-infra-calc-beta-onboarding-v1";
export const ONBOARDING_OPENED_STORAGE_KEY = "arknights-infra-calc-onboarding-opened-v1";
export const ONBOARDING_VISITS_STORAGE_KEY = "arknights-infra-calc-onboarding-visits-v1";
export const ONBOARDING_VISIT_PAGES = ["manual", "training", "skill-query", "recruitment", "training-planner", "settings"] as const satisfies readonly AppPage[];
export const ONBOARDING_TASK_COUNT = 3 + ONBOARDING_VISIT_PAGES.length;
export type OnboardingVisitPage = typeof ONBOARDING_VISIT_PAGES[number];
export const ONBOARDING_DISMISSED_VALUE = "dismissed";
export const ONBOARDING_COMPLETED_VALUE = "completed";
export const ONBOARDING_FINISHED_VALUE = "finished";

export type SetupStep = "box" | "layout" | "facilities";
export type OnboardingPreference = "active" | "dismissed" | "completed" | "finished";
export type OnboardingStepStatus = "current" | "complete" | "upcoming";

export function parseOnboardingVisits(storedValue: string | null): OnboardingVisitPage[] {
  try {
    const parsed: unknown = JSON.parse(storedValue ?? "[]");
    return Array.isArray(parsed) ? ONBOARDING_VISIT_PAGES.filter(page => parsed.includes(page)) : [];
  } catch {
    return [];
  }
}

export function resolveOnboardingPreference(
  storedValue: string | null,
  hasSuccessfulPlan: boolean,
): OnboardingPreference {
  if (storedValue === "1" || storedValue === ONBOARDING_DISMISSED_VALUE) return "dismissed";
  if (storedValue === ONBOARDING_FINISHED_VALUE) return "finished";
  if (hasSuccessfulPlan || storedValue === ONBOARDING_COMPLETED_VALUE) return "completed";
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
