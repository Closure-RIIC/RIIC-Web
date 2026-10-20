import { handleListSavedPlans } from "@/server/saved-plans-api";


export async function GET(request: Request) {
  return handleListSavedPlans(request, "/api/account/saved-plans");
}
