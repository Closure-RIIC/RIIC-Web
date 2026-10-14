import { NO_FEATURE_ACCESS } from "@/feature-access";
import { getFeatureAccess } from "@/server/auth/feature-access";


export async function GET(request: Request) {
  try {
    return Response.json(await getFeatureAccess(request), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json(NO_FEATURE_ACCESS, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
