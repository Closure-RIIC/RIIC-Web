"use client";

const eventName = "riic-billing-updated";
const storageKey = "riic-billing-revision";

export function notifyBillingUpdated() {
  window.dispatchEvent(new Event(eventName));
  // Invalidate other tabs without storing balances, account IDs or codes.
  try { localStorage.setItem(storageKey, crypto.randomUUID()); } catch { /* Storage may be disabled. */ }
}

export function subscribeBillingUpdates(refresh: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === storageKey) refresh(); };
  window.addEventListener(eventName, refresh);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(eventName, refresh); window.removeEventListener("storage", storage); };
}
