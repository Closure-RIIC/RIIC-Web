"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useLocale } from "use-intl";
import { loadGameCatalog } from "./game-data.ts";
import type { EnglishCatalog } from "./game-catalog.ts";
import { loadUserSettings, USER_SETTINGS_CHANGED_EVENT, type UserSettings } from "../user-settings.ts";

type CatalogListener = () => void;

export function createGameCatalogStore(loader: () => Promise<EnglishCatalog> = loadGameCatalog) {
  let snapshot: EnglishCatalog | null = null;
  let pending: Promise<EnglishCatalog> | null = null;
  const listeners = new Set<CatalogListener>();
  return {
    subscribe(listener: CatalogListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    // React uses this for SSR and every consumer's first hydration render.
    getServerSnapshot: () => null,
    ensureLoaded() {
      pending ??= loader().then((catalog) => {
        if (snapshot !== catalog) {
          snapshot = catalog;
          listeners.forEach((listener) => listener());
        }
        return catalog;
      }).catch((error) => {
        pending = null;
        throw error;
      });
      return pending;
    },
  };
}

const gameCatalogStore = createGameCatalogStore();

/** A stable null server snapshot prevents cached game data from racing streamed hydration. */
export function useGameCatalog(): EnglishCatalog | null {
  const locale = useLocale();
  const catalog = useSyncExternalStore(
    gameCatalogStore.subscribe,
    gameCatalogStore.getSnapshot,
    gameCatalogStore.getServerSnapshot,
  );
  useEffect(() => {
    const ensureLoaded = (enabled: boolean) => {
      if (locale === "en" && !catalog && enabled) {
        void gameCatalogStore.ensureLoaded().catch(() => { /* Keep upstream text and retry after a later mount. */ });
      }
    };
    const onSettingsChange = (event: Event) => ensureLoaded((event as CustomEvent<UserSettings>).detail.loadEnglishResources);
    ensureLoaded(loadUserSettings(window.localStorage).loadEnglishResources);
    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, onSettingsChange);
    return () => window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, onSettingsChange);
  }, [catalog, locale]);
  return locale === "en" ? catalog : null;
}
