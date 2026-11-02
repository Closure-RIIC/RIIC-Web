import type { AppLocale } from "@riic/contracts/locale";
import { localize as rotationText } from "./i18n/helpers/RotationLabels.ts";
import { localize as localize_rotation_settings } from "./i18n/helpers/rotation_settings.ts";
import type { RotationProfile, RotationTiming, RotationTopology } from "./types";

export type RotationOption = {
  profile: RotationProfile;
  label: string;
  durations: number[];
};

export const DEFAULT_ROTATION_PROFILE: RotationProfile = "abc_12_6_6";

export const ROTATION_OPTIONS: RotationOption[] = [
  { profile: "abc_12_6_6", label: "一天三换", durations: [12, 6, 6] },
  { profile: "main_backup_12_12", label: "主备轮换", durations: [12, 12] },
  { profile: "abc_12_12_12", label: "一天两换", durations: [12, 12, 12] },
  { profile: "main_backup_24_24", label: "主备 24/24", durations: [24, 24] },
  { profile: "fiammetta_8_8_4_4", label: "菲亚梅塔轮换", durations: [8, 8, 4, 4] },
  { profile: "abyssal_7_5_7_5", label: "深海猎人轮换", durations: [7, 5, 7, 5] },
];

/** 旧会话里可能还保存着这些 profile，仍然要能读出来并正常展示。 */
export const LEGACY_ROTATION_PROFILES: RotationProfile[] = [
  "fiammetta_8_8_4_4",
  "abyssal_7_5_7_5",
];

/**
 * 求解器对“自定义时长”的归一化名字。它们只说明班次数，
 * 具体时长由 `rotation.shifts[].duration_hours` 提供。
 */
export const GENERIC_ROTATION_PROFILES: RotationProfile[] = ["generic_main_backup", "generic_abc"];

/** generic_* → 班次数；不是 generic 时返回 null。 */
export function genericShiftCount(profile: RotationProfile): number | null {
  if (profile === "generic_main_backup") return 2;
  if (profile === "generic_abc") return 3;
  return null;
}

const SUPPORTED_ROTATION_PROFILES: RotationProfile[] = [
  ...ROTATION_OPTIONS.map(({ profile }) => profile),
  ...GENERIC_ROTATION_PROFILES,
];

export function isRotationProfile(value: unknown): value is RotationProfile {
  return typeof value === "string" && SUPPORTED_ROTATION_PROFILES.includes(value as RotationProfile);
}

export function normalizeRotationProfile(value: unknown): RotationProfile {
  return isRotationProfile(value) ? value : DEFAULT_ROTATION_PROFILE;
}

const GENERIC_ROTATION_OPTIONS: Record<string, RotationOption> = {
  generic_main_backup: { profile: "generic_main_backup", label: "自定义", durations: [] },
  generic_abc: { profile: "generic_abc", label: "自定义", durations: [] },
};

/**
 * 取预设项。generic_* 没有固定时长，`durations` 返回空数组——
 * 调用方必须回到 `rotation.shifts[].duration_hours` 取真实班时。
 */
export function rotationOption(profile: RotationProfile): RotationOption {
  return ROTATION_OPTIONS.find((option) => option.profile === profile)
    ?? GENERIC_ROTATION_OPTIONS[profile]
    ?? ROTATION_OPTIONS[0];
}

/** 固定时长；generic_* 返回空数组，表示“时长未知，看 shifts”。 */
export function rotationDurations(profile: RotationProfile): number[] {
  return [...rotationOption(profile).durations];
}

export function rotationDescription(profile: RotationProfile, en: AppLocale = "zh-CN"): string {
  const hours = localize_rotation_settings.text(en, "hours");
  const durations = rotationDurations(profile);
  // generic_* 的时长取决于本次结果，这里只给名字。
  if (!durations.length) return rotationText.text(en, profile);
  return `${rotationText.text(en, profile)} · ${durations.join("/")} ${hours}`;
}

/** 班次数：generic_* 由名字决定，其余看固定时长。 */
export function rotationShiftCount(profile: RotationProfile): number {
  return genericShiftCount(profile) ?? rotationDurations(profile).length;
}

/* ------------------------------------------------------------------ *
 * 自定义时长（求解器 v7 `{ topology, shift_hours }`）
 * ------------------------------------------------------------------ */

/** 界面里“自定义”项的值；和 named profile 一起放进下拉框。 */
export const CUSTOM_ROTATION = "custom" as const;

export type RotationSelection = RotationProfile | typeof CUSTOM_ROTATION;

export type CustomRotation = {
  topology: RotationTopology;
  /** 整数小时，长度由 topology 决定（二班 2 个、三班 3 个）。 */
  hours: number[];
};

/**
 * 求解器只校验数值安全，周期组合由调用方决定。
 * 这里维护唯一一份业务规则：二/三班普通周期只允许 24 / 36 / 48 小时。
 */
export const ALLOWED_CYCLE_HOURS = [24, 36, 48] as const;

export const ROTATION_TOPOLOGY_SHIFTS: Record<RotationTopology, number> = {
  main_backup: 2,
  abc: 3,
};

export const DEFAULT_CUSTOM_ROTATION: CustomRotation = { topology: "main_backup", hours: [12, 12] };

/** 自定义时长的默认值：按拓扑给出一个合法组合。 */
export function defaultCustomRotation(topology: RotationTopology): CustomRotation {
  return { topology, hours: topology === "main_backup" ? [12, 12] : [12, 6, 6] };
}

export type CustomRotationProblem =
  | { kind: "shift-count"; expected: number; actual: number }
  | { kind: "hour-range"; index: number }
  | { kind: "cycle-total"; total: number; allowed: readonly number[] };

/** 校验自定义时长；合法返回 null。 */
export function validateCustomRotation(value: CustomRotation): CustomRotationProblem | null {
  const expected = ROTATION_TOPOLOGY_SHIFTS[value.topology];
  if (value.hours.length !== expected) {
    return { kind: "shift-count", expected, actual: value.hours.length };
  }
  const invalidIndex = value.hours.findIndex((hour) => !Number.isInteger(hour) || hour < 1);
  if (invalidIndex >= 0) return { kind: "hour-range", index: invalidIndex };
  const total = value.hours.reduce((sum, hour) => sum + hour, 0);
  if (!ALLOWED_CYCLE_HOURS.includes(total as (typeof ALLOWED_CYCLE_HOURS)[number])) {
    return { kind: "cycle-total", total, allowed: ALLOWED_CYCLE_HOURS };
  }
  return null;
}

/** 自定义设置 → `plan.compute` 的 `options.rotation`。 */
export function toRotationTiming(value: CustomRotation): RotationTiming {
  if (value.topology === "main_backup") {
    return { topology: "main_backup", shift_hours: [value.hours[0]!, value.hours[1]!] };
  }
  return { topology: "abc", shift_hours: [value.hours[0]!, value.hours[1]!, value.hours[2]!] };
}

/** 下拉框的选中值 → 请求字段；自定义且不合法时返回 null。 */
export function resolveRotationTiming(
  selection: RotationSelection,
  custom: CustomRotation,
): RotationTiming | null {
  if (selection !== CUSTOM_ROTATION) return selection;
  return validateCustomRotation(custom) ? null : toRotationTiming(custom);
}

/** 选中值 → 时长数组，用于班次数量与展示（自定义不合法时退回默认两班）。 */
export function selectionDurations(selection: RotationSelection, custom: CustomRotation): number[] {
  if (selection !== CUSTOM_ROTATION) return rotationDurations(selection);
  return [...custom.hours];
}

/** 选中值是否指向自定义时长。 */
export function isCustomRotation(selection: RotationSelection): selection is typeof CUSTOM_ROTATION {
  return selection === CUSTOM_ROTATION;
}

/* ------------------------------------------------------------------ *
 * 换班方式的字符串编码（缓存键、私有记录、日志都用这一份）
 * ------------------------------------------------------------------ */

/** 自定义换班方式的字符串前缀。 */
export const CUSTOM_ROTATION_PREFIX = "custom_";

/** 拓扑在字符串里的简称：主备用 zb，ABC 用 abc。 */
const TOPOLOGY_KEYS: Record<RotationTopology, string> = { main_backup: "zb", abc: "abc" };
const KEY_TOPOLOGIES: Record<string, RotationTopology> = { zb: "main_backup", abc: "abc" };

/**
 * 把换班方式压成一个字符串：
 *   named profile 原样返回（`abc_12_6_6`）；
 *   自定义编码为 `custom_{zb|abc}_{H1}_{H2}[_{H3}]`，例如 `custom_zb_16_8`。
 * 服务端记录与缓存键只接受字符串，这个格式可以无损还原。
 */
export function encodeRotationKey(timing: RotationTiming): string {
  if (typeof timing === "string") return timing;
  return `${CUSTOM_ROTATION_PREFIX}${TOPOLOGY_KEYS[timing.topology]}_${timing.shift_hours.join("_")}`;
}

/**
 * 解析换班方式字符串，只做**形状**解析，不做周期校验。
 *
 * `custom_zb_10_10` 是合法形状（10 小时不是合法周期，那是业务校验的事），
 * 这样 UI 可以把用户正在编辑的中间态也存成 key。形状非法才返回 null。
 */
export function decodeRotationKey(key: string): RotationTiming | null {
  if (isRotationProfile(key)) return key;
  const custom = customRotationFromKey(key);
  return custom ? toRotationTiming(custom) : null;
}

/** 把 `custom_{zb|abc}_{h...}` 解析成拓扑与时长；形状非法返回 null。 */
export function customRotationFromKey(key: string): CustomRotation | null {
  if (!key.startsWith(CUSTOM_ROTATION_PREFIX)) return null;
  const parts = key.slice(CUSTOM_ROTATION_PREFIX.length).split("_");
  const topology = KEY_TOPOLOGIES[parts[0] ?? ""];
  if (!topology) return null;
  const hours = parts.slice(1).map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (hours.length !== ROTATION_TOPOLOGY_SHIFTS[topology]) return null;
  if (!hours.every((hour) => Number.isInteger(hour) && hour > 0)) return null;
  return { topology, hours };
}

/** key 是否为自定义形状（`custom_` 开头）。 */
export function isCustomRotationKey(key: string): boolean {
  return key.startsWith(CUSTOM_ROTATION_PREFIX);
}

/** 从字符串推断班次数；无法识别返回 null。 */
export function rotationShiftCountFromKey(key: string): number | null {
  const timing = decodeRotationKey(key);
  if (!timing) return null;
  return typeof timing === "string" ? rotationShiftCount(timing) : timing.shift_hours.length;
}
