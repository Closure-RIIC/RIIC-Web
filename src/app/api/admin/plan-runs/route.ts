import { handleListAdminRecords } from "@/server/admin-records-api";


export async function GET(request: Request) {
  return handleListAdminRecords(request, "runs", "/api/admin/plan-runs");
}
