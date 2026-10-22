import { handleDeleteSklandAccountData } from "../../../skland/account-data-api";


export async function DELETE(request: Request) {
  return handleDeleteSklandAccountData(request, "/api/skland/account-data");
}
