import {
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  failureResponse,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "@riic/platform-server/api-contract";
import { requireWebsiteSession } from "@riic/platform-server/auth/authorization";
import { getDatabase } from "@riic/platform-server/db";
import { telemetryEvent } from "@riic/platform-server/db/schema";
import { activeSklandAccount, readSklandAccountStore } from "@riic/platform-server/skland/http";
import { sklandDataOwnerTag } from "@riic/platform-server/skland/session";
import {
  MAX_TELEMETRY_EVENTS_PER_REQUEST,
  telemetryEventValues,
  validateTelemetryEvent,
  telemetryValidationIssue,
} from "@/server/telemetry";


export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const ip = requestClientIp(request);
    enforceRateLimit("telemetry", ip, 60, 60_000, "AIC-RATE-6001");

    const body = await readJsonBody(request, 128 * 1024) as { events?: unknown };
    if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > MAX_TELEMETRY_EVENTS_PER_REQUEST) {
      throw new PublicApiError("AIC-REQ-1001", {
        fieldErrors: [{ path: "events", code: "invalid_events", message: "埋点事件数量需要在 1-20 之间。" }],
      });
    }
    const events = body.events.map(validateTelemetryEvent);
    if (events.some((event) => event === null)) {
      throw new PublicApiError("AIC-REQ-1001", {
        fieldErrors: body.events.flatMap((event,index) => {
          const issue=telemetryValidationIssue(event);
          return issue ? [{...issue,path:`events[${index}].${issue.path}`}] : [];
        }).slice(0,8),
      });
    }

    let userId: string | null = null;
    try {
      userId = (await requireWebsiteSession(request)).user.id;
    } catch {
      // 游客埋点不强制登录。
    }
    let dataOwnerTag: string | null = null;
    try {
      const account = userId ? activeSklandAccount(await readSklandAccountStore(userId)) : null;
      if (account) dataOwnerTag = sklandDataOwnerTag(account.session.userId);
    } catch {
      // 无森空岛会话时为 null。
    }

    const now = new Date();
    const validEvents = events as NonNullable<ReturnType<typeof validateTelemetryEvent>>[];
    // Expiration cleanup belongs to the hourly business-record maintenance,
    // including deployments without a plan worker, not each event submission.
    await getDatabase().insert(telemetryEvent).values(
      validEvents.map((event) => telemetryEventValues(event, { userId, dataOwnerTag, now })),
    );

    return successResponse({ accepted: validEvents.length }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/telemetry", startedAt, "AIC-SYS-5000", request);
  }
}
