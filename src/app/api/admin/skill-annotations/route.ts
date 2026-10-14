import {
  handleCreateAdminSkillAnnotation,
  handleListAdminSkillAnnotations,
} from "@/server/skill-annotations-api";


export async function GET(request: Request) {
  return handleListAdminSkillAnnotations(request);
}

export async function POST(request: Request) {
  return handleCreateAdminSkillAnnotation(request);
}
