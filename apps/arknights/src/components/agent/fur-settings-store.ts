"use client";

import { useMemo, useSyncExternalStore } from "react";
import { agentFurSettings, FUR_STORAGE_KEY, savedFurSettings, type AgentFurSurface, type FurSettings } from "./fur-settings";

const CHANGE_EVENT = "riic:plush-settings";
const emptySnapshot = () => "";
const noSubscription = () => () => {};

function snapshot() {
  try { return localStorage.getItem(FUR_STORAGE_KEY) ?? ""; }
  catch { return ""; }
}

function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === FUR_STORAGE_KEY || event.key === null) notify();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(CHANGE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(CHANGE_EVENT, notify);
  };
}

export function notifyFurSettingsChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useAgentFurSettings(variant: string, enabled: boolean, surface: AgentFurSurface = "chat") {
  const serialized = useSyncExternalStore(enabled ? subscribe : noSubscription, enabled ? snapshot : emptySnapshot, emptySnapshot);
  // The store contains every persona. Preserve this portrait's settings identity
  // when another character changes, so it does not enqueue an unchanged GPU frame.
  const key = useMemo(() => JSON.stringify(agentFurSettings(savedFurSettings(serialized, variant), surface)), [serialized, variant, surface]);
  return useMemo(() => JSON.parse(key) as FurSettings, [key]);
}
