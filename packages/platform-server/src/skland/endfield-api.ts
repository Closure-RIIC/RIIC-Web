import { getCookies } from "../request-context";
import { isCurrentPolicyConsent } from "@riic/platform/legal-policy";
import { EndfieldDataError } from "@riic/endfield-skland/model";
import { assertSameOrigin, createRequestId, enforceRateLimit, PublicApiError, readJsonBody, requestClientIp, successResponse } from "../api-contract";
import { requireWebsiteSession } from "../auth/authorization";
import { setResponseCookie } from "../response-cookies";
import { bindSklandAccount } from "./bindings";
import { parseSklandCredential, SklandCredentialFormatError } from "./credential";
import { consumeEndfieldScan, endfieldCredential, endfieldRoles, endfieldSync, invalidateEndfieldSnapshots, pollEndfieldScan, startEndfieldScan } from "./endfield-adapter";
import { enforceSklandPollRateLimit } from "./poll-rate-limit";
import { assertSklandAvailable, readSklandAccountStore, sklandErrorResponse } from "./http";
import { sealOwnedSklandAccount, websiteUserOwnerTag, sklandAccountCookieName, SklandAccountLimitError, type SklandStoredAccount } from "./session";
import { endfieldCookieName, readEndfieldAccounts, upsertEndfieldAccount } from "./endfield-accounts";
export { ENDFIELD_SKLAND_COOKIE } from "./endfield-accounts";

function writeAccount(response: Response, request: Request, account: SklandStoredAccount, owner: string, direct: boolean) {
  setResponseCookie(response, direct ? endfieldCookieName(account.accountId) : sklandAccountCookieName(account.accountId),
    sealOwnedSklandAccount(account, websiteUserOwnerTag(owner)), {
      path: "/", httpOnly: true, sameSite: "lax",
      secure: new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
      maxAge: Math.max(1, Math.ceil((account.session.expiresAt - Date.now()) / 1000)),
    });
}

async function handle(request: Request, action: string) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  const route = `/api/endfield/skland/${action}`;
  try {
    assertSklandAvailable(request);
    const website = await requireWebsiteSession(request);
    const owner = website.user.id;
    if (request.method === "POST") {
      if (!request.headers.get("origin")) throw new PublicApiError("AIC-AUTH-2002");
      assertSameOrigin(request);
    }
    if (action === "qr-status") enforceSklandPollRateLimit(owner, requestClientIp(request));
    else if (request.method === "GET" && action === "accounts") {
      // Focus/refresh checks only inspect local login cookies; keep their budget
      // separate from requests that contact Skland.
      enforceRateLimit("endfield-skland-status", owner, 120, 10 * 60_000);
      enforceRateLimit("endfield-skland-status-ip", requestClientIp(request), 300, 10 * 60_000);
    }
    else {
      enforceRateLimit("endfield-skland-account", owner, 30, 10 * 60_000);
      enforceRateLimit("endfield-skland-ip", requestClientIp(request), 90, 10 * 60_000);
    }
    const directAccounts = readEndfieldAccounts(getCookies(), owner);
    if (request.method === "GET" && action === "accounts") {
      const store = await readSklandAccountStore(owner);
      return successResponse({
        ownerKey: websiteUserOwnerTag(owner),
        accounts: [
          ...directAccounts.map(account => ({ id: account.accountId, label: account.roles[0]?.nickname || "终末地账号", source: "endfield" })),
          ...store.accounts.filter(account => !directAccounts.some(item => item.session.userId === account.session.userId)).map((account, index) => ({
            id: account.accountId, label: account.roles[0]?.nickname || `森空岛账号 ${index + 1}`, source: "arknights",
          })),
        ],
      }, requestId);
    }
    if (request.method !== "POST" || !["credential", "roles", "sync", "disconnect", "qr", "qr-status"].includes(action)) {
      return Response.json({ error: { message: "Not found" } }, { status: 404 });
    }
    const body = await readJsonBody(request, 16 * 1024) as Record<string, unknown> | null;
    if (action === "qr") {
      if (!isCurrentPolicyConsent(body?.consent)) throw new PublicApiError("AIC-AUTH-2005");
      return successResponse(await startEndfieldScan(owner, requestClientIp(request), body.consent), requestId);
    }
    if (action === "qr-status") {
      if (typeof body?.scanId !== "string" || !body.scanId.trim() || body.scanId.length > 256) throw new PublicApiError("AIC-REQ-1001");
      const scanId = body.scanId.trim();
      const authenticated = await pollEndfieldScan(scanId, owner, request.signal);
      if (!("session" in authenticated)) return successResponse({ status: authenticated.status }, requestId);
      request.signal.throwIfAborted();
      const account = upsertEndfieldAccount(directAccounts, authenticated.session, authenticated.result);
      await bindSklandAccount(owner, authenticated.session.userId);
      request.signal.throwIfAborted();
      const response = successResponse({ status: "authenticated", accountId: account.accountId, roles: authenticated.result }, requestId);
      writeAccount(response, request, account, owner, true);
      consumeEndfieldScan(scanId, owner);
      return response;
    }
    if (action === "disconnect") {
      const account = directAccounts.find(item => item.accountId === body?.accountId);
      if (!account) throw new PublicApiError("AIC-AUTH-2001");
      invalidateEndfieldSnapshots(owner);
      const response = successResponse({ disconnected: true }, requestId);
      setResponseCookie(response, endfieldCookieName(account.accountId), "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0, secure: new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https" });
      return response;
    }
    if (action === "credential") {
      if (!isCurrentPolicyConsent(body?.consent)) throw new PublicApiError("AIC-AUTH-2005");
      let credential;
      try { credential = parseSklandCredential(body?.credential); }
      catch (error) {
        if (error instanceof SklandCredentialFormatError) throw new PublicApiError("AIC-AUTH-2010");
        throw error;
      }
      const authenticated = await endfieldCredential(credential, { ...body.consent, acceptedAt: Date.now() });
      request.signal.throwIfAborted();
      const account = upsertEndfieldAccount(directAccounts, authenticated.session, authenticated.result);
      // Same ownership rule as the existing Arknights connection.
      await bindSklandAccount(owner, authenticated.session.userId);
      request.signal.throwIfAborted();
      const response = successResponse({ accountId: account.accountId, roles: authenticated.result }, requestId);
      writeAccount(response, request, account, owner, true);
      return response;
    }
    const accountId = typeof body?.accountId === "string" ? body.accountId : "";
    const direct = directAccounts.find(item => item.accountId === accountId);
    const account = direct ?? (await readSklandAccountStore(owner)).accounts.find(item => item.accountId === accountId);
    if (!account) throw new PublicApiError("AIC-AUTH-2001");
    if (action === "roles") {
      const loaded = await endfieldRoles(account.session);
      const response = successResponse({ accountId, roles: loaded.result }, requestId);
      writeAccount(response, request, { ...account, session: loaded.session }, owner, !!direct);
      return response;
    }
    if (typeof body?.roleId !== "string" || typeof body.serverId !== "string"
      || !body.roleId || !body.serverId || body.roleId.length > 128 || body.serverId.length > 128) throw new PublicApiError("AIC-REQ-1001");
    const loaded = await endfieldSync(account.session, { roleId: body.roleId, serverId: body.serverId }, { userId: owner, accountId, force: body.force === true });
    const response = successResponse({ snapshot: loaded.result }, requestId);
    // Update only the credential; the Arknights active account/character is untouched.
    writeAccount(response, request, { ...account, session: loaded.session }, owner, !!direct);
    return response;
  } catch (error) {
    const safe = error instanceof EndfieldDataError || error instanceof SklandAccountLimitError ? new PublicApiError("AIC-BOX-1101", { message: error.message }) : error;
    return sklandErrorResponse(safe, requestId, route, startedAt, request);
  }
}

export async function handleEndfieldSkland(request: Request, action: string) {
  const response = await handle(request, action);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
