import structuredClonePolyfill from "@ungap/structured-clone";
import ResizeObserverPolyfill from "resize-observer-polyfill";

type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;

const browserGlobal = typeof window !== "undefined" ? window : undefined;

if (browserGlobal && typeof browserGlobal.structuredClone !== "function") {
  browserGlobal.structuredClone = structuredClonePolyfill;
}

if (browserGlobal && typeof browserGlobal.requestIdleCallback !== "function") {
  browserGlobal.requestIdleCallback = function requestIdleCallbackFallback(callback: IdleCallback): number {
    const start = Date.now();
    return window.setTimeout(() => {
      callback({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
      });
    }, 1);
  };
}

if (browserGlobal && typeof browserGlobal.cancelIdleCallback !== "function") {
  browserGlobal.cancelIdleCallback = (handle: number) => window.clearTimeout(handle);
}

if (browserGlobal && typeof browserGlobal.ResizeObserver !== "function") {
  browserGlobal.ResizeObserver = ResizeObserverPolyfill;
}

if (browserGlobal?.crypto && typeof browserGlobal.crypto.randomUUID !== "function") {
  Object.defineProperty(browserGlobal.crypto, "randomUUID", {
    configurable: true,
    value: () => {
      const bytes = new Uint8Array(16);
      browserGlobal.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    },
  });
}
