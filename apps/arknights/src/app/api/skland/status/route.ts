import { handleLegacyGetSklandStatus } from "@/server/skland/status-api";


export async function GET(request: Request) {
  return handleLegacyGetSklandStatus(request);
}
