import type { RotationProfile, RotationShift } from "./types.ts";

export function formatPlanDuration(durationMs: number): string {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (safeDurationMs < 1000) return `${Math.round(safeDurationMs)} ms`;
  return `${(safeDurationMs / 1000).toFixed(1)} 秒`;
}

export type RotationMetricKind = "trade" | "manu" | "power";

function compactNumber(value: number, digits = 1): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits).replace(/\.?0+$/, "");
}

export function rotationTeamLabel(profile: RotationProfile, team: string): string {
  const normalized = team.trim().toLowerCase();
  const usesMainBackup = profile === "main_backup_12_12";
  if (normalized === "alpha") return usesMainBackup ? "主力" : "α";
  if (normalized === "beta") return usesMainBackup ? "替补" : "β";
  if (normalized === "gamma") return "γ";
  return team;
}

export function shiftTabLabel(shift: RotationShift | undefined, index: number): string {
  if (!shift) return `第 ${index + 1} 班`;
  return `第 ${index + 1} 班 · ${compactNumber(shift.duration_hours)}h`;
}

export function shiftTeamSummary(shift: RotationShift | undefined, profile: RotationProfile): string | null {
  if (!shift) return null;
  const active = shift.active_teams.map((team) => rotationTeamLabel(profile, team)).filter(Boolean);
  const resting = rotationTeamLabel(profile, shift.resting_team);
  if (active.length === 0 && !resting) return null;
  if (active.length === 0) return `${resting} 休息`;
  if (!resting) return `${active.join("+")} 上班`;
  return `${active.join("+")} 上班 · ${resting} 休息`;
}

export function rotationMetricValue(kind: RotationMetricKind, value: number): number {
  return kind === "trade" ? value : value * 100;
}

export function relativeMetricDelta(current: number, baseline: number): number | undefined {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return undefined;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}
