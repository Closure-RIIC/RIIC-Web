import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, successResponse } from "@riic/platform-server/api-contract";
import { requireWebsiteAdmin, requireWebsiteSuperAdmin } from "@riic/platform-server/auth/authorization";
import { billingMonthly, billingMonthlyRange, BillingMonthlyError } from "@/server/billing/monthly-report";
import { getReferralCampaign, setReferralCampaign, ReferralError } from "@riic/platform-server/referral/service";
import { adjustBilling, BillingAdminError, billingOverview, billingRange, billingRunDetail, changeAgentPolicy, getAgentPolicies, listBilling, resolveBillingReview, testAgentFilter } from "@/server/billing/admin";

async function handle(request: Request) {
  const id = createRequestId(); const start = performance.now(); let response: Response;
  try {
    const access = await requireWebsiteAdmin(request);
    const { session } = access;
    const params = new URL(request.url).searchParams;
    const section = params.get("section") ?? "summary";
    if (section === "access" && request.method === "GET") {
      response = successResponse({ isSuperAdmin: access.isSuperAdmin }, id);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    // Daily account bookkeeping remains delegated. All other sections, including
    // raw model costs, global policies and campaign switches, require root access.
    const ordinary = request.method === "GET"
      ? ["wallets", "ledger", "orders", "reviews"] : ["adjust", "review"];
    if (!ordinary.includes(section)) await requireWebsiteSuperAdmin(request);
    let data: unknown;
    if (request.method === "GET") {
      if (section === "summary") { const { from, to } = billingRange(params); data = await billingOverview(from, to); }
      else if (section === "monthly") { const { from, to } = billingMonthlyRange(params); data = await billingMonthly(from, to); }
      else if (section === "policies") data = await getAgentPolicies();
      else if (section === "referral") data = await getReferralCampaign();
      else if (section === "run") data = await billingRunDetail((params.get("id") ?? "").slice(0, 128));
      else data = await listBilling(section, params);
    } else {
      assertSameOrigin(request); enforceRateLimit("admin-billing", session.user.id, 30, 60_000);
      const body = await readJsonBody(request, 128 * 1024);
      if (section === "adjust") data = await adjustBilling(session.user.id, body);
      else if (section === "policies") data = await changeAgentPolicy(session.user.id, body);
      else if (section === "referral") data = await setReferralCampaign(session.user.id, body);
      else if (section === "filter-test") data = await testAgentFilter(body);
      else if (section === "review") data = await resolveBillingReview(session.user.id, body);
      else throw new BillingAdminError("未知操作。");
    }
    response = successResponse(data, id);
  } catch (error) {
    response = failureResponse(error instanceof BillingAdminError || error instanceof BillingMonthlyError || error instanceof ReferralError ? new PublicApiError("AIC-REQ-1001", { message: error.message }) : error, id, "/api/admin/billing", start, "AIC-SYS-5000", request);
  }
  response.headers.set("Cache-Control", "private, no-store"); return response;
}
export const GET = handle;
export const POST = handle;
