import type { FurPerformanceTier } from "./fur-performance.ts";

export type FurQualityObservation = { slowFrames: number; since: number };
export const newFurQualityObservation = (): FurQualityObservation => ({ slowFrames: 0, since: 0 });

/** Only completed draw costs enter this policy: never RAF gaps or shader compilation.
 * Downgrades persist until explicit retry, so idle/hover cannot pump image sharpness. */
export function observeFurQuality(tier: FurPerformanceTier, state: FurQualityObservation, frameMs: number, now: number): FurPerformanceTier {
  if (tier === "static" || !Number.isFinite(frameMs) || frameMs <= 0) return tier;
  if (frameMs > 1500) { state.slowFrames = 0; state.since = 0; return "static"; }
  const threshold = tier === "quality" ? 28 : tier === "balanced" ? 50 : 120;
  if (frameMs <= threshold) { state.slowFrames = 0; state.since = 0; return tier; }
  if (!state.slowFrames) state.since = now;
  state.slowFrames++;
  if (state.slowFrames < 8 || now - state.since < 1200) return tier;
  state.slowFrames = 0; state.since = 0;
  return tier === "quality" ? "balanced" : tier === "balanced" ? "saver" : "static";
}
