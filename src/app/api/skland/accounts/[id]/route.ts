import { handleDeleteSklandAccount } from "@/server/skland/accounts-api";


export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleDeleteSklandAccount(request, id, "/api/skland/accounts/[id]");
}
