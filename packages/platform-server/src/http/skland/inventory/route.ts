import { handleGetSklandInventory } from "../../../skland/inventory-api";


export async function GET(request: Request) {
  return handleGetSklandInventory(request, "/api/skland/inventory");
}
