"use client";
import { useEffect, useSyncExternalStore } from "react";
import { COLOR_MODE_STORAGE_KEY, parseColorMode, type ColorMode } from "@/color-mode";

const eventName = "riic-color-mode-change";
let fallback: ColorMode = "light";
function readMode(): ColorMode {
  try { return parseColorMode(localStorage.getItem(COLOR_MODE_STORAGE_KEY)); }
  catch { return fallback; }
}
function applyMode(mode: ColorMode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.style.colorScheme = mode;
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === COLOR_MODE_STORAGE_KEY || event.key === null) listener(); };
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(eventName, listener); window.removeEventListener("storage", storage); };
}
export function setColorMode(mode: ColorMode) {
  fallback = mode;
  try { localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode); } catch { /* Apply in this tab if storage is unavailable. */ }
  applyMode(mode);
  window.dispatchEvent(new Event(eventName));
}
export function useColorMode() {
  return useSyncExternalStore(subscribe, readMode, () => "light" as const);
}
export function ColorModeController() {
  const mode = useColorMode();
  useEffect(() => applyMode(mode), [mode]);
  return null;
}
