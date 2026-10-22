import { assertOperbox } from "./operbox.ts";
import { validateLayoutJson } from "./layout-validation.ts";
import { isRotationProfile } from "./rotation-settings.ts";
import type { BaseBlueprint, OperBoxEntry, RotationProfile } from "./types.ts";

export const REPRODUCTION_FILE_LIMIT = 2 * 1024 * 1024;
export type ReproductionSettings = { layout: BaseBlueprint; rotation: RotationProfile; fiammetta_enable: boolean };
export type ReproductionPackage = ReproductionSettings & {
  format: "riic-reproduction";
  version: 1;
  operbox: OperBoxEntry[];
  diagnosticId?: string;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("复现包必须是对象。");
  return value as Record<string, unknown>;
}

/** Pure parser: never reads or writes the user's workspace or supplies solver defaults. */
export function parseReproductionPackage(value: unknown, boxSettings?: ReproductionSettings): ReproductionPackage {
  const boxOnly = Array.isArray(value);
  if (boxOnly && !boxSettings) throw new Error("仅包含 box，请先选择布局、轮换及菲亚梅塔设置。");
  const raw = boxOnly ? { ...boxSettings, operbox: value } : record(value);
  if ((raw.format !== undefined || raw.version !== undefined) && (raw.format !== "riic-reproduction" || raw.version !== 1)) {
    throw new Error("不支持此复现包格式或版本。");
  }
  const operbox = assertOperbox(raw.operbox);
  const errors = validateLayoutJson(raw.layout);
  if (errors.length) throw new Error(`布局无效：${errors.join("；")}`);
  if (!isRotationProfile(raw.rotation)) throw new Error("缺少有效的轮换参数。");
  if (typeof raw.fiammetta_enable !== "boolean") throw new Error("缺少有效的菲亚梅塔设置。");
  if (raw.diagnosticId !== undefined && (typeof raw.diagnosticId !== "string" || raw.diagnosticId.length > 100)) throw new Error("诊断编号无效。");
  const supported = new Set(["format", "version", "operbox", "layout", "rotation", "fiammetta_enable", "diagnosticId"]);
  const unknown = Object.keys(raw).filter((key) => !supported.has(key));
  if (unknown.length) throw new Error(`包含尚不支持的参数，不能静默忽略：${unknown.join("、")}`);
  return {
    format: "riic-reproduction", version: 1, operbox,
    layout: structuredClone(raw.layout as BaseBlueprint), rotation: raw.rotation,
    fiammetta_enable: raw.fiammetta_enable,
    ...(typeof raw.diagnosticId === "string" ? { diagnosticId: raw.diagnosticId } : {}),
  };
}

export function readReproductionPackage(text: string, boxSettings?: ReproductionSettings): ReproductionPackage {
  if (new TextEncoder().encode(text).byteLength > REPRODUCTION_FILE_LIMIT) throw new Error("单文件不能超过 2 MiB。");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("JSON 无法解析，请检查文件是否完整。"); }
  return parseReproductionPackage(value, boxSettings);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Source metadata is excluded; all supported solver settings participate. */
export function reproductionInputKey(input: ReproductionPackage): string {
  return canonical({ operbox: input.operbox, layout: input.layout, rotation: input.rotation, fiammetta_enable: input.fiammetta_enable });
}
