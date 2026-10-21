"use client";

import { useSyncExternalStore } from "react";
import { FUR_PERFORMANCE_STORAGE_KEY, normalizeFurPerformanceMode, type FurPerformanceMode } from "./fur-performance";

const CHANGE_EVENT = "riic:plush-performance";
let memoryPreference: FurPerformanceMode = "auto";
let storageWriteFailed = false;
const serverSnapshot = (): FurPerformanceMode => "auto";

function snapshot(): FurPerformanceMode {
  if (storageWriteFailed) return memoryPreference;
  try { return normalizeFurPerformanceMode(localStorage.getItem(FUR_PERFORMANCE_STORAGE_KEY)); }
  catch { return memoryPreference; }
}

export function readFurPerformanceMode(): FurPerformanceMode {
  return typeof window === "undefined" ? "auto" : snapshot();
}

function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === FUR_PERFORMANCE_STORAGE_KEY || event.key === null) {
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

function setMode(input: FurPerformanceMode) {
  memoryPreference = normalizeFurPerformanceMode(input);
  try {
    localStorage.setItem(FUR_PERFORMANCE_STORAGE_KEY, memoryPreference);
    storageWriteFailed = false;
  } catch { storageWriteFailed = true; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useFurPerformanceMode(): [FurPerformanceMode, (mode: FurPerformanceMode) => void] {
  return [useSyncExternalStore(subscribe, snapshot, serverSnapshot), setMode];
}
