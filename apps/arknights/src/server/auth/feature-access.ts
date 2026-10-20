import "@tanstack/react-start/server-only";

import { eq } from "drizzle-orm";
import { canAccessFeature, featureAccessMode, type RestrictedFeature, type FeatureAccess } from "@/feature-access";
import { PublicApiError } from "@/server/api-contract";
import { getDatabase } from "@/server/db";
import { user } from "@/server/db/schema";
import { websiteSession } from ".";
import { websiteAdminAccess } from "./admin-access";
import { requireWebsiteSession } from "./authorization";

async function currentAccount(userId: string) {
  const [record] = await getDatabase().select({ role: user.role, banned: user.banned }).from(user).where(eq(user.id, userId)).limit(1);
  return { active: Boolean(record && !record.banned), isAdmin: Boolean(record && !record.banned && websiteAdminAccess(userId, record.role).isAdmin) };
}

export async function getFeatureAccess(request: Request | Headers): Promise<FeatureAccess> {
  const session = await websiteSession(request);
  const account = session?.user.id ? await currentAccount(session.user.id) : null;
  const allowed = (feature: RestrictedFeature) => (account === null || account.active) && canAccessFeature(featureAccessMode(feature), account?.isAdmin ?? false);
  return { agent: allowed("agent"), billing: allowed("billing") };
}

export async function requireFeatureActor(request: Request | Headers, feature: RestrictedFeature) {
  const mode = featureAccessMode(feature);
  if (mode === "disabled") throw new PublicApiError("AIC-AUTH-2007");
  const session = await requireWebsiteSession(request);
  // Read the database on every protected request: cached session roles are not authoritative.
  const account = await currentAccount(session.user.id);
  if (!account.active || !canAccessFeature(mode, account.isAdmin)) throw new PublicApiError("AIC-AUTH-2009");
  return { session, isAdmin: account.isAdmin };
}

export async function requireFeatureSession(request: Request | Headers, feature: RestrictedFeature) {
  return (await requireFeatureActor(request, feature)).session;
}
