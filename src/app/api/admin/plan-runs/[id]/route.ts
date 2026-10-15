import { handleGetAdminPlanRunDetail } from "@/server/admin-records-api";


export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleGetAdminPlanRunDetail(request, id);
}
