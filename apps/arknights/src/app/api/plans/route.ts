import { handleListSavedPlans } from "@/server/saved-plans-api";

export async function GET(request: Request) {
  const response = await handleListSavedPlans(request, "/api/plans");
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", "</api/account/saved-plans>; rel=\"successor-version\"");
  return response;
}
