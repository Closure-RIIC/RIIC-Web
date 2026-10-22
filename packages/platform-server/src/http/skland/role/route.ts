import {
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "../../../api-contract";
import { selectSessionRole, SklandServiceError } from "../../../skland/adapter";
import {
  assertSklandAvailable,
  assertSklandFeatureEnabled,
  readSklandAccountStore,
  setSklandAccountStoreCookies,
  sklandAccountSummaries,
  sklandErrorResponse,
  type SklandAccountStore,
  withUpdatedSklandAccount,
} from "../../../skland/http";
import { removeSklandAccount } from "../../../skland/session";
import { requireWebsiteSession } from "../../../auth/authorization";
import { getSklandBindingSummary } from "../../../skland/bindings";


export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  let previous: SklandAccountStore | null = null;
  let targetAccountId: string | null = null;
  try {
    assertSklandFeatureEnabled();
    const website = await requireWebsiteSession(request);
    assertSklandAvailable(request);
    assertSameOrigin(request);
    enforceRateLimit("skland-action", requestClientIp(request), 30, 60 * 60_000);
    previous = await readSklandAccountStore();
    const body = await readJsonBody(request, 16 * 1024) as { accountId?: unknown; uid?: unknown } | null;
    if (typeof body?.uid !== "string") throw new PublicApiError("AIC-REQ-1001");
    if (body.accountId !== undefined && typeof body.accountId !== "string") throw new PublicApiError("AIC-REQ-1001");
    targetAccountId = typeof body.accountId === "string" ? body.accountId : previous.activeAccountId;
    const account = previous.accounts.find((current) => current.accountId === targetAccountId);
    if (!account) throw new SklandServiceError("AUTH_EXPIRED", "请先登录森空岛。", 401);
    if (!account.roles.some((role) => role.uid === body.uid)) throw new PublicApiError("AIC-REQ-1001");
    const result = await selectSessionRole(account.session, body.uid);
    const next = withUpdatedSklandAccount(previous, account.accountId, result.session, result.snapshot);
    const bindingSummary = await getSklandBindingSummary(website.user.id);
    const response = successResponse({
      authenticated: true,
      configured: true,
      accounts: sklandAccountSummaries(next),
      activeAccountId: next.activeAccountId,
      bindingCount: bindingSummary.totalCount,
      bindingSummary,
      scheduleSnapshot: result.snapshot,
      statusSnapshot: result.statusSnapshot,
    }, requestId);
    setSklandAccountStoreCookies(response, request, next, previous);
    return response;
  } catch (error) {
    const response = sklandErrorResponse(error, requestId, "/api/skland/role", startedAt, request);
    if (
      previous &&
      targetAccountId &&
      error instanceof SklandServiceError &&
      error.code === "AUTH_EXPIRED"
    ) {
      const removed = removeSklandAccount(
        previous.accounts,
        previous.activeAccountId === targetAccountId ? previous.activeAccountId : null,
        targetAccountId
      );
      const next = {
        ...previous,
        accounts: removed.accounts,
        activeAccountId: previous.activeAccountId === targetAccountId
          ? removed.activeAccountId
          : previous.activeAccountId,
        migratedSnapshot: null,
      };
      setSklandAccountStoreCookies(response, request, next, previous);
    }
    return response;
  }
}
