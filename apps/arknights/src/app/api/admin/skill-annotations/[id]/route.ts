import {
  handleDeleteAdminSkillAnnotation,
  handleUpdateAdminSkillAnnotation,
} from "@/server/skill-annotations-api";


export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleUpdateAdminSkillAnnotation(request, id);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleDeleteAdminSkillAnnotation(request, id);
}
