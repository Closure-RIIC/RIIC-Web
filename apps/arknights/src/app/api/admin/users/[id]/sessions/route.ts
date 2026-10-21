import {
  handleDeleteAdminUserSessions,
  handleListAdminUserSessions,
} from "@/server/admin-users-api";


export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleListAdminUserSessions(request, id);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleDeleteAdminUserSessions(request, id);
}
