import {
  handleDeleteAllSklandAccounts,
  handleGetSklandAccounts,
} from "@/server/skland/accounts-api";


export async function GET(request: Request) {
  return handleGetSklandAccounts(request, "/api/skland/accounts");
}

export async function DELETE(request: Request) {
  return handleDeleteAllSklandAccounts(request, "/api/skland/accounts");
}
