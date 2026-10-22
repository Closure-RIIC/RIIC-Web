import { eq } from "drizzle-orm";
import { websiteSession } from "./index";
import { websiteAdminAccess } from "./admin-access";
import { getDatabase } from "../db";
import { user } from "../db/schema";

/** Shared by the application gate and the ingress auth_request subrequest. */
export async function endfieldAccessResponse(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers });
  try {
    const session = await websiteSession(request);
    if (session?.user.id) {
      // Session role snapshots can outlive a demotion or ban; always read the current account.
      const [account] = await getDatabase().select({ role: user.role, banned: user.banned })
        .from(user).where(eq(user.id, session.user.id)).limit(1);
      if (account && !account.banned && websiteAdminAccess(session.user.id, account.role).isAdmin) {
        return new Response(null, { status: 204, headers });
      }
    }
  } catch {
    // An unavailable account service must never make the preview public.
  }
  return new Response(null, { status: 403, headers });
}
