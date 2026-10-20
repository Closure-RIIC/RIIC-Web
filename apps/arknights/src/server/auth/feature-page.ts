import "@tanstack/react-start/server-only";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { notFound } from "@tanstack/react-router";
import { featureAccessMode, type RestrictedFeature } from "@/feature-access";
import { requireFeatureSession } from "./feature-access";

export async function requireFeaturePage(feature: RestrictedFeature) {
  // Public pages keep their sign-in prompt; APIs still require a valid account.
  if (featureAccessMode(feature) === "public") return;
  const requestHeaders = getRequestHeaders();
  try {
    await requireFeatureSession(requestHeaders, feature);
  } catch {
    throw notFound();
  }
}
