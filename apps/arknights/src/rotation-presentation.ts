import type { AppLocale } from "@riic/contracts/locale";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type Messages from "../messages/zh-CN/RotationPresentation.json";
const text = createLocalizer<typeof Messages>("RotationPresentation");
import type { RotationProfile, RotationShift } from "@riic/arknights-domain/types";

export function formatPlanDuration(durationMs: number, locale: AppLocale = "zh-CN"): string {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (safeDurationMs < 1000) return `${Math.round(safeDurationMs)} ms`;
  return text.text(locale, "seconds", { seconds: (safeDurationMs / 1000).toFixed(1) });
}

export type RotationMetricKind = "trade" | "manu" | "power";

function compactNumber(value: number, digits = 1): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits).replace(/\.?0+$/, "");
}

export function rotationTeamLabel(profile: RotationProfile, team: string, locale: AppLocale = "zh-CN"): string {
  const normalized = team.trim().toLowerCase();
  const usesMainBackup = profile === "main_backup_12_12";
  if (normalized === "alpha") return usesMainBackup ? text.text(locale, "main") : "α";
  if (normalized === "beta") return usesMainBackup ? text.text(locale, "backup") : "β";
  if (normalized === "gamma") return "γ";
  return team;
}

export function shiftTabLabel(shift: RotationShift | undefined, index: number, locale: AppLocale = "zh-CN"): string {
  if (!shift) return text.text(locale, "shift", { index: index + 1 });
  return text.text(locale, "shiftDuration", { index: index + 1, hours: compactNumber(shift.duration_hours) });
}

export function shiftTeamSummary(shift: RotationShift | undefined, profile: RotationProfile, locale: AppLocale = "zh-CN"): string | null {
  if (!shift) return null;
  const active = shift.active_teams.map((team) => rotationTeamLabel(profile, team, locale)).filter(Boolean);
  const resting = rotationTeamLabel(profile, shift.resting_team, locale);
  if (active.length === 0 && !resting) return null;
  if (active.length === 0) return text.text(locale, "resting", { team: resting });
  if (!resting) return text.text(locale, "working", { team: active.join("+") });
  return text.text(locale, "teams", { active: active.join("+"), resting });
}

export function rotationMetricValue(kind: RotationMetricKind, value: number): number {
  return kind === "trade" ? value : value * 100;
}

export function relativeMetricDelta(current: number, baseline: number): number | undefined {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return undefined;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}
