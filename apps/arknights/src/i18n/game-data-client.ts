"use client";

import { useMessages, type AbstractIntlMessages } from "use-intl";
import type { GameCatalog } from "./game-catalog.ts";

/** The serialized feature snapshot is identical for SSR and hydration. */
export function useGameCatalog(): GameCatalog {
  const messages: AbstractIntlMessages = useMessages();
  const catalog = messages.ArknightsGameData;
  if (!catalog) throw new Error("Arknights game resources were not loaded by the active feature");
  return catalog as unknown as GameCatalog;
}
