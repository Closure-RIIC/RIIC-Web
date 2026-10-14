import { handleAdminReleaseMutation } from "@/server/release-notes-api";


export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleAdminReleaseMutation(request, (await context.params).id);
}
