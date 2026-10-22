import { STORAGE_CREDENTIAL_KEY, STORAGE_DID_KEY, STORAGE_OAUTH_TOKEN_KEY } from "skland-kit";
import { normalizeEndfieldInventory, type EndfieldInventory } from "@riic/endfield-skland/inventory";
import { normalizeEndfieldWeapons, type EndfieldWeapons } from "@riic/endfield-skland/weapons";
import { sklandSignedHeaders } from "./credential.ts";

export const ENDFIELD_MATERIAL_LIST_PATH = "/web/v1/game/endfield/calculate/material-list";
export const ENDFIELD_USER_GAME_DATA_PATH = "/web/v1/game/endfield/calculate/user-game-data";

export interface EndfieldInventoryClient {
  storage: { getItem: (key: string) => Promise<string | null> };
  $fetch: (url: string, options: {
    method: "GET"; headers: Record<string, string>; timeout: number; retry: 0; redirect: "error";
  }) => Promise<unknown>;
}

/** Called only after binding ownership has been verified. Credentials stay server-side. */
export async function readEndfieldCalculatorData(
  client: EndfieldInventoryClient,
  selected: { roleId: string; serverId: string },
): Promise<{ inventory: EndfieldInventory; weapons: EndfieldWeapons }> {
  const unavailable = () => ({ inventory: { status: "unavailable" as const, items: [] }, weapons: { status: "unavailable" as const, items: [] } });
  try {
    const [cred, token, dId] = await Promise.all([
      client.storage.getItem(STORAGE_CREDENTIAL_KEY),
      client.storage.getItem(STORAGE_OAUTH_TOKEN_KEY),
      client.storage.getItem(STORAGE_DID_KEY),
    ]);
    if (!cred || !token) return unavailable();
    // Verified against the official cost-calculator client: GET, no query/body,
    // and sk-game-role = 3_<roleId>_<serverId> for both reads.
    const responses = await Promise.allSettled([ENDFIELD_MATERIAL_LIST_PATH, ENDFIELD_USER_GAME_DATA_PATH].map(path =>
      client.$fetch(`https://zonai.skland.com${path}`, {
        method: "GET", timeout: 12_000, retry: 0, redirect: "error",
        headers: {
          ...sklandSignedHeaders({ cred, token, dId: dId ?? "", path }),
          "sk-game-role": `3_${selected.roleId}_${selected.serverId}`,
        },
      })));
    const gameResponse = responses[1].status === "fulfilled" ? responses[1].value : undefined;
    return { inventory: normalizeEndfieldInventory(
      responses[0].status === "fulfilled" ? responses[0].value : undefined,
      gameResponse,
      selected,
    ), weapons: normalizeEndfieldWeapons(gameResponse, selected) };
  } catch {
    // Optional inventory must not prevent the existing character/ship sync.
    // Never expose upstream errors, request headers or credentials.
    return unavailable();
  }
}

export async function readEndfieldInventory(client: EndfieldInventoryClient, selected: { roleId: string; serverId: string }) {
  return (await readEndfieldCalculatorData(client, selected)).inventory;
}
