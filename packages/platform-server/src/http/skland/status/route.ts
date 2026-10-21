import { handleLegacyGetSklandStatus } from "../../../skland/status-api";


export async function GET(request: Request) {
  return handleLegacyGetSklandStatus(request);
}
