import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { notFound } from "@tanstack/react-router";

export const getPublicPageConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { legalIdentity } = await import("../legal");
  return { identity: legalIdentity(), sklandEnabled: process.env.APP_CLIENT_SKLAND_ENABLED === "1" };
});

export const getReviewerAccess = createServerFn({ method: "GET" }).handler(async () => {
  const { requireWebsiteReviewer } = await import("./auth/authorization");
  try { const access = await requireWebsiteReviewer(getRequest()); return { isAdmin: access.isAdmin, name: access.session.user.name }; }
  catch { throw notFound(); }
});

export const getAdminAccess = createServerFn({ method: "GET" }).handler(async () => {
  const { requireWebsiteAdmin } = await import("./auth/authorization");
  try { await requireWebsiteAdmin(getRequest()); return { isAdmin: true }; }
  catch { throw notFound(); }
});

export const getAdminHealth = createServerFn({ method: "GET" }).handler(async () => {
  const { requireWebsiteReviewer } = await import("./auth/authorization");
  try { await requireWebsiteReviewer(getRequest()); } catch { throw notFound(); }
  const { getHealth } = await import("./infra");
  const health = await getHealth();
  return { plannerReady: Boolean(health.ok && health.cliReady), solverFingerprint: health.serve?.fingerprint ?? null };
});

export const getFeaturePageAccess = createServerFn({ method: "GET" })
  .validator((feature: "agent" | "billing") => {
    if (feature !== "agent" && feature !== "billing") throw new Error("Invalid feature");
    return feature;
  })
  .handler(async ({ data }) => {
    const { requireFeaturePage } = await import("./auth/feature-page");
    await requireFeaturePage(data);
    return null;
  });

export const getAdminPreviewAccess = createServerFn({ method: "GET" }).handler(async () => {
  const { adminPreviewEnabled } = await import("../admin-preview-policy");
  if (!adminPreviewEnabled(process.env)) throw notFound();
  return null;
});

export const getPlanArtifactPage = createServerFn({ method: "GET" })
  .validator((id: string) => {
    if (typeof id !== "string" || !id || id.length > 128) throw notFound();
    return id;
  })
  .handler(async ({ data }) => {
    const { requireFeatureSession } = await import("./auth/feature-access");
    const { getAgentPlanArtifact } = await import("./agent/plan-artifact");
    const session = await requireFeatureSession(getRequest(), "agent").catch(() => null);
    if (!session?.user) throw notFound();
    const artifact = await getAgentPlanArtifact(data, session.user.id).catch(() => null);
    if (!artifact) throw notFound();
    return { planJson: JSON.stringify(artifact.plan), meta: artifact.meta, createdAt: artifact.createdAt.toISOString() };
  });
