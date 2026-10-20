import { handleUpdateAdminUser } from "@/server/admin-users-api";


export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleUpdateAdminUser(request, id);
}
