// Multipliers preserve each persona's authored coat and colors at the defaults.
export const FUR_CONTROLS = [
  { key: "length", label: "毛长", min: 0.2, max: 2, step: 0.05, default: 1 },
  { key: "density", label: "密度", min: 0.5, max: 4, step: 0.05, default: 1 },
  { key: "thickness", label: "粗细", min: 0.25, max: 1.5, step: 0.05, default: 1 },
  { key: "mess", label: "蓬乱", min: 0, max: 3, step: 0.05, default: 1 },
  { key: "curl", label: "卷曲", min: 0, max: 4, step: 0.05, default: 1 },
  { key: "gravity", label: "重力", min: 0, max: 3, step: 0.05, default: 1 },
  { key: "brightness", label: "亮度", min: 0.5, max: 2, step: 0.05, default: 1 },
  { key: "rim", label: "轮廓光", min: 0, max: 3, step: 0.05, default: 1 },
  { key: "wind", label: "风力", min: 0, max: 3, step: 0.05, default: 1 },
  { key: "shells", label: "毛发层数", min: 12, max: 64, step: 1, default: 28 },
  { key: "resolution", label: "分辨率倍率", min: 0.5, max: 1.5, step: 0.1, default: 1 },
  { key: "fps", label: "帧率上限", min: 15, max: 60, step: 1, default: 30 },
  { key: "zoom", label: "缩放", min: 0.7, max: 1.4, step: 0.05, default: 1 },
  { key: "yaw", label: "水平角度", min: -180, max: 180, step: 1, default: 0 },
  { key: "pitch", label: "俯仰角度", min: -45, max: 45, step: 1, default: 0 },
  { key: "eyeRoughness", label: "眼睛粗糙度", min: 0.05, max: 0.8, step: 0.05, default: 0.3 },
  { key: "eyeClearcoat", label: "眼睛清漆", min: 0, max: 1, step: 0.05, default: 1 },
] as const;

export type FurSettings = Record<typeof FUR_CONTROLS[number]["key"], number>;
export const DEFAULT_FUR_SETTINGS = Object.freeze(Object.fromEntries(FUR_CONTROLS.map(c => [c.key, c.default])) as FurSettings);
export const FUR_PRESETS = {
  original: DEFAULT_FUR_SETTINGS,
  fine: { ...DEFAULT_FUR_SETTINGS, shells: 64, density: 1.2, thickness: 1, resolution: 1.2 },
  saver: { ...DEFAULT_FUR_SETTINGS, shells: 20, resolution: 0.7, fps: 24 },
} satisfies Record<string, FurSettings>;

export const FUR_STORAGE_KEY = "riic.plush.lab.v2";

/** Appearance is shared; rendering budgets belong to the consuming surface. */
export type AgentFurSurface = "chat" | "portrait";

export function agentFurSettings(input: unknown, surface: AgentFurSurface = "chat"): FurSettings {
  return { ...normalizeFurSettings(input), shells: surface === "portrait" ? 40 : 28, resolution: surface === "portrait" ? 1.5 : 1.1, fps: 60 };
}

export function galleryFurSettings(input: unknown): FurSettings {
  return { ...normalizeFurSettings(input), shells: 64, resolution: 1.2, fps: 60 };
}

export function savedFurSettings(serialized: string, variant: string): FurSettings {
  try {
    const data = JSON.parse(serialized);
    if (![1, 2].includes(data?.version) || !data.personas || typeof data.personas !== "object" || Array.isArray(data.personas)) return FUR_PRESETS.fine;
    const saved = Object.hasOwn(data.personas, variant) ? data.personas[variant] : undefined;
    return saved && typeof saved === "object" && !Array.isArray(saved) ? normalizeFurSettings(saved) : FUR_PRESETS.fine;
  } catch { return FUR_PRESETS.fine; }
}

export function normalizeFurSettings(input: unknown): FurSettings {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return Object.fromEntries(FUR_CONTROLS.map(control => {
    const value = source[control.key];
    const safe = typeof value === "number" && Number.isFinite(value) ? value : control.default;
    const bounded = Math.max(control.min, Math.min(control.max, safe));
    return [control.key, control.step === 1 ? Math.round(bounded) : bounded];
  })) as FurSettings;
}
