import { handleLegacyAdminUsersGet, handleLegacyAdminUsersPost } from "@/server/admin-users-api";


export async function GET(request: Request) {
  return handleLegacyAdminUsersGet(request);
}

export async function POST(request: Request) {
  return handleLegacyAdminUsersPost(request);
}
