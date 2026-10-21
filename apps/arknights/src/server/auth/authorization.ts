import "@tanstack/react-start/server-only";

import { eq } from "drizzle-orm";
import { PublicApiError } from "@/server/api-contract";
import { getDatabase } from "@/server/db";
import { user } from "@/server/db/schema";
import { websiteSession } from ".";
import { websiteAdminAccess } from "./admin-access";
import { localTestSession } from "./local-test-account";

export async function requireWebsiteSession(request: Request | Headers) {
  const local = localTestSession(request);
  if (local) return local;
  let session;
  try {
    session = await websiteSession(request);
  } catch (cause) {
    throw new PublicApiError("AIC-AUTH-2008", { cause });
  }
  if (!session?.user?.id) throw new PublicApiError("AIC-AUTH-2008");
  return session;
}

async function requireWebsiteAccess(request: Request | Headers, permission: "isAdmin" | "canAccessReview") {
  const session = await requireWebsiteSession(request);
  const [record] = await getDatabase()
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);
  const access = websiteAdminAccess(session.user.id, record?.role);
  if (!record || !access[permission]) throw new PublicApiError("AIC-AUTH-2009");
  return { session, ...access };
}

export function requireWebsiteAdmin(request: Request | Headers) {
  return requireWebsiteAccess(request, "isAdmin");
}

export function requireWebsiteReviewer(request: Request | Headers) {
  return requireWebsiteAccess(request, "canAccessReview");
}
