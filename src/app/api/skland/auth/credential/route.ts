import {
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "@/server/api-contract";
import { requireWebsiteSession } from "@/server/auth/authorization";
import { isCurrentPolicyConsent } from "@/legal-policy";
import { authenticateSklandCredential } from "@/server/skland/adapter";
import { finalizeSklandAuthentication } from "@/server/skland/auth-completion";
import {
  parseSklandCredential,
  SklandCredentialFormatError,
} from "@/server/skland/credential";
import {
  assertSklandAvailable,
  assertSklandFeatureEnabled,
  setSklandAccountStoreCookies,
  sklandErrorResponse,
} from "@/server/skland/http";


export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    const website = await requireWebsiteSession(request);
    assertSklandAvailable(request);
    if (!request.headers.get("origin")) throw new PublicApiError("AIC-AUTH-2002");
    assertSameOrigin(request);
    enforceRateLimit("skland-credential-account", website.user.id, 10, 10 * 60_000);
    enforceRateLimit("skland-credential-ip", requestClientIp(request), 20, 10 * 60_000);

    const body = await readJsonBody(request, 16 * 1024) as {
      credential?: unknown;
      consent?: unknown;
    } | null;
    if (!isCurrentPolicyConsent(body?.consent)) throw new PublicApiError("AIC-AUTH-2005");

    let credential: ReturnType<typeof parseSklandCredential>;
    try {
      credential = parseSklandCredential(body?.credential);
    } catch (error) {
      if (error instanceof SklandCredentialFormatError) throw new PublicApiError("AIC-AUTH-2010");
      throw error;
    }

    const result = await authenticateSklandCredential(credential, {
      termsVersion: body.consent.termsVersion,
      privacyVersion: body.consent.privacyVersion,
      acceptedAt: Date.now(),
    });
    const completed = await finalizeSklandAuthentication(website.user.id, result);
    const response = successResponse(completed.data, requestId);
    setSklandAccountStoreCookies(response, request, completed.next, completed.previous);
    return response;
  } catch (error) {
    return sklandErrorResponse(error, requestId, "/api/skland/auth/credential", startedAt, request);
  }
}
