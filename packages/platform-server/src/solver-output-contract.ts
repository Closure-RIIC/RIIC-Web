import { ROTATION_TOPOLOGY_SHIFTS, rotationShiftCount } from "@riic/arknights-domain/rotation-settings";
import type { RotationProfile, RotationTiming } from "@riic/arknights-domain/types";

const record=(value: unknown): value is Record<string,unknown> => value!==null && typeof value==="object" && !Array.isArray(value);

/** Reject partial successful responses before accepting an engine as the winner. */
export function assertCompleteSolverOutput(payload: {
  profile: Record<string,unknown>; rotation: Record<string,unknown>; maa: Record<string,unknown>;
}, requested: RotationTiming): void {
  // 自定义时长时求解器返回 generic_* profile，班次数由请求拓扑决定；
  // named profile 仍按原口径校验。
  const custom = typeof requested === "string" ? null : requested;
  const automatic = custom?.topology === "auto" || requested === "auto";
  const count = automatic ? 2 : custom ? ROTATION_TOPOLOGY_SHIFTS[custom.topology] : rotationShiftCount(requested as RotationProfile);
  const autoHours = automatic ? custom?.shift_hours ?? [24, 24] : null;
  const expectedProfile = automatic
    ? autoHours?.[0] === 24 && autoHours[1] === 24 ? "main_backup_24_24" : "generic_main_backup"
    : custom ? null : (requested as RotationProfile);
  const {maa,rotation}=payload;
  if (payload.profile.schema_version!==4 || !Array.isArray(payload.profile.domains) || payload.profile.domains.length===0
    || !record(payload.profile.summary) || typeof payload.profile.summary.owned!=="number" || payload.profile.summary.owned<=0) {
    throw new Error("Solver returned an incomplete account profile.");
  }
  if ((expectedProfile !== null && rotation.profile !== expectedProfile)
    || !Array.isArray(rotation.shifts) || rotation.shifts.length!==count || !rotation.shifts.every(record)) {
    throw new Error("Solver returned an incomplete or mismatched rotation.");
  }
  if (automatic) {
    const metadata = rotation.auto_rotation;
    const timing = record(metadata) && record(metadata.timing) ? metadata.timing : null;
    const reportedHours = timing?.shift_hours;
    const rooms = record(metadata) && Array.isArray(metadata.rooms) ? metadata.rooms : null;
    const dormSupport = record(metadata) && Array.isArray(metadata.constant_dorm_support) ? metadata.constant_dorm_support : null;
    if (!record(metadata) || !Array.isArray(reportedHours) || reportedHours.length !== 2
      || reportedHours[0] !== autoHours?.[0] || reportedHours[1] !== autoHours?.[1]
      || typeof metadata.complete !== "boolean" || !rooms?.every(room => record(room)
        && typeof room.room_id === "string" && typeof room.facility === "string"
        && Number.isInteger(room.main_missing_seats) && Number(room.main_missing_seats) >= 0
        && Number.isInteger(room.backup_missing_seats) && Number(room.backup_missing_seats) >= 0
        && typeof room.main_complete === "boolean" && typeof room.backup_complete === "boolean")
      || !dormSupport?.every(item => Array.isArray(item) && item.length === 2 && typeof item[0] === "string"
        && Array.isArray(item[1]) && item[1].every(name => typeof name === "string"))) {
      throw new Error("Solver returned incomplete automatic rotation metadata.");
    }
    if (!rotation.shifts.every((shift, index) => shift.duration_hours === autoHours?.[index])) {
      throw new Error("Solver returned automatic shifts with mismatched durations.");
    }
  }
  if (typeof maa.title!=="string" || !maa.title.trim() || typeof maa.description!=="string"
    || (typeof maa.planTimes!=="string" && typeof maa.planTimes!=="number")
    || !Array.isArray(maa.plans) || maa.plans.length!==count) {
    throw new Error("Solver returned incomplete MAA plans.");
  }
  for (const plan of maa.plans) {
    if(!record(plan) || typeof plan.name!=="string" || !plan.name.trim() || !record(plan.rooms) || Object.keys(plan.rooms).length===0) {
      throw new Error("Solver returned an incomplete MAA plan.");
    }
    for(const rooms of Object.values(plan.rooms)) {
      if(!Array.isArray(rooms) || !rooms.every(room=>record(room) && Array.isArray(room.operators))) {
        throw new Error("Solver returned invalid MAA rooms.");
      }
    }
  }
}
