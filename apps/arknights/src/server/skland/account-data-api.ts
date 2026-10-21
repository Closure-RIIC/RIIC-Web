import "@tanstack/react-start/server-only";

import {
  assertEmptyBody,
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  requestClientIp,
  successResponse,
} from "../api-contract";
import { requireWebsiteSession } from "../auth/authorization";
import { deleteSklandOwnedData } from "../infra";
import { evictSklandPlanCaches } from "../plan-cache";
import { removeSklandBindings } from "./bindings";
import {
  assertSklandAvailable,
  assertSklandFeatureEnabled,
  readSklandAccountStore,
  setSklandAccountStoreCookies,
  sklandErrorResponse,
} from "./http";
import { sklandDataOwnerTag } from "./session";

export async function handleDeleteSklandAccountData(request: Request, route: string) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    const website = await requireWebsiteSession(request);
    assertSklandAvailable(request);
    assertSameOrigin(request);
    await assertEmptyBody(request, 1024);
    enforceRateLimit("skland-delete", requestClientIp(request), 5, 60 * 60_000);
    const previous = await readSklandAccountStore(website.user.id);
    await evictSklandPlanCaches(website.user.id);
    const deleted = await deleteSklandOwnedData(
      previous.accounts.map((account) => sklandDataOwnerTag(account.session.userId)),
    );
    await removeSklandBindings(website.user.id);
    const next = {
      ...previous,
      accounts: [],
      activeAccountId: null,
      migratedSnapshot: null,
    };
    const response = successResponse({ deleted: true, ...deleted }, requestId);
    setSklandAccountStoreCookies(response, request, next, previous);
    return response;
  } catch (error) {
    return sklandErrorResponse(error, requestId, route, startedAt, request);
  }
}

export async function handleLegacyDeleteSklandData(request: Request) {
  const response = await handleDeleteSklandAccountData(request, "/api/skland/data");
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", "</api/skland/account-data>; rel=\"successor-version\"");
  return response;
}
