import { handleRefreshSklandStatus } from "../../../../skland/status-api";


export async function POST(request: Request) {
  return handleRefreshSklandStatus(request, "/api/skland/status/refresh");
}
