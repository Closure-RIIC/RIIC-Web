import { handleListSkillAnnotations } from "@/server/skill-annotations-api";


export async function GET(request: Request) {
  return handleListSkillAnnotations(request);
}
