import type { AgentFurSurface, FurSettings } from "./fur-settings.ts";

export type FurPerformanceMode = "auto" | "quality" | "balanced" | "saver" | "static";
export type FurPerformanceTier = Exclude<FurPerformanceMode, "auto">;

// Device preference is deliberately separate from exported persona appearances.
export const FUR_PERFORMANCE_STORAGE_KEY = "riic.plush.performance.v1";

export function normalizeFurPerformanceMode(input: unknown): FurPerformanceMode {
  return input === "quality" || input === "balanced" || input === "saver" || input === "static"
    ? input : "auto";
}

export function resolvePerformanceTier(mode: FurPerformanceMode, software: boolean): FurPerformanceTier {
  return mode === "auto" ? software ? "saver" : "quality" : mode;
}

/** Apply a device budget without mutating or renormalizing authored appearance. */
export function performanceSettings(settings: FurSettings, tier: FurPerformanceTier, gallery: boolean, surface: AgentFurSurface = "chat"): FurSettings {
  if (tier === "quality" || tier === "static") return { ...settings };
  const saver = tier === "saver";
  if (!gallery) {
    const portrait = surface === "portrait";
    // Preserve the inexpensive chat fallback on software GPUs. Larger portraits
    // get a little more detail without inheriting the high-quality rendering cost.
    return {
      ...settings,
      shells: Math.min(settings.shells, saver ? portrait ? 16 : 12 : portrait ? 28 : 24),
      resolution: Math.min(settings.resolution, saver ? portrait ? 0.6 : 0.4 : portrait ? 1.1 : 0.9),
      fps: Math.min(settings.fps, saver ? 24 : 30),
    };
  }
  return {
    ...settings,
    shells: Math.min(settings.shells, saver ? 20 : 36),
    resolution: settings.resolution * (saver ? 0.5 : 0.75),
    fps: Math.min(settings.fps, saver ? 24 : 30),
  };
}
