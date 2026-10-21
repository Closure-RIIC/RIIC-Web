import { handleDeleteSavedPlan, handleUpdateSavedPlan } from "@/server/saved-plans-api";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const response = await handleUpdateSavedPlan(request, context, "/api/plans/[id]");
  const { id } = await context.params;
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", `</api/account/saved-plans/${encodeURIComponent(id)}>; rel="successor-version"`);
  return response;
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const response = await handleDeleteSavedPlan(request, context, "/api/plans/[id]");
  const { id } = await context.params;
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", `</api/account/saved-plans/${encodeURIComponent(id)}>; rel="successor-version"`);
  return response;
}
