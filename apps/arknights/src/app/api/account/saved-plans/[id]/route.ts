import { handleDeleteSavedPlan, handleUpdateSavedPlan } from "@/server/saved-plans-api";


export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleUpdateSavedPlan(request, context, "/api/account/saved-plans/[id]");
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleDeleteSavedPlan(request, context, "/api/account/saved-plans/[id]");
}
