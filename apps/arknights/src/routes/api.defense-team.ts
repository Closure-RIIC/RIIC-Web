import { createFileRoute } from "@tanstack/react-router";
import { requireWebsiteSession } from "@riic/platform-server/auth/authorization";
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
import { parseDefenseInput } from "../defense-team-validation";
import {
  listDefenseRooms,
  mutateDefenseRoom,
  getDefenseProfile,
} from "../server/defense-team";

async function handle(request: Request) {
  const id = createRequestId(),
    started = performance.now();
  try {
    const session = await requireWebsiteSession(request);
    if (request.method === "POST") {
      assertSameOrigin(request);
      enforceRateLimit("defense-team-user", session.user.id, 30, 60_000);
      enforceRateLimit("defense-team-ip", requestClientIp(request), 90, 60_000);
      const input = parseDefenseInput(await readJsonBody(request, 4096));
      if (!input) throw new PublicApiError("AIC-REQ-1001");
      await mutateDefenseRoom(session.user.id, input);
    }
    const response = successResponse(
      {
        rooms: await listDefenseRooms(session.user.id),
        profile: await getDefenseProfile(session.user.id),
      },
      id,
    );
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
    return response;
  } catch (error) {
    return failureResponse(error, id, "/api/defense-team", started);
  }
}
export const Route = createFileRoute("/api/defense-team")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
