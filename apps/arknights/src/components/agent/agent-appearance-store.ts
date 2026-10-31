"use client";

import { useSyncExternalStore } from "react";

export type CloudAppearance = "frost-cloud" | "glow-cloud";
export type AgentAppearance = "plush" | CloudAppearance;

const STORAGE_KEY = "riic.agent.appearance.v1";
const LEGACY_STORAGE_KEY = "riic.agent.closure-appearance.v1";
const CHANGE_EVENT = "riic:agent-appearance";
let memoryPreference: AgentAppearance = "plush";
let storageWriteFailed = false;
const serverSnapshot = (): AgentAppearance => "plush";

function snapshot(): AgentAppearance {
  if (storageWriteFailed) return memoryPreference;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "plush" || value === "frost-cloud" || value === "glow-cloud") return value;
    return value === null && localStorage.getItem(LEGACY_STORAGE_KEY) === "vinyl" ? "frost-cloud" : "plush";
  } catch { return memoryPreference; }
}

function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === LEGACY_STORAGE_KEY || event.key === null) {
      storageWriteFailed = false;
      notify();
    }
  };
  window.addEventListener("storage", storage);
  window.addEventListener(CHANGE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(CHANGE_EVENT, notify);
  };
}

function setAppearance(appearance: AgentAppearance): boolean {
  memoryPreference = appearance;
  try {
    localStorage.setItem(STORAGE_KEY, appearance);
    storageWriteFailed = false;
  } catch { storageWriteFailed = true; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return !storageWriteFailed;
}

export function useAgentAppearance(): [AgentAppearance, (appearance: AgentAppearance) => boolean] {
  return [useSyncExternalStore(subscribe, snapshot, serverSnapshot), setAppearance];
}
