import { handleLegacyDeleteSklandData } from "@/server/skland/account-data-api";


export async function DELETE(request: Request) {
  return handleLegacyDeleteSklandData(request);
}
