import { handleGetAdminFeedbackDetail, handleUpdateAdminFeedback } from "@/server/admin-records-api";


export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleGetAdminFeedbackDetail(request, id);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleUpdateAdminFeedback(request, id);
}
