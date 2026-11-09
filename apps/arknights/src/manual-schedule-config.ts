export const MANUAL_SCHEDULE_STORAGE_KEY = "arknights-infra-manual-schedule-v1";
export const MOOD_STORAGE_KEY = "riic.manual-mood.v1";
export const DEFAULT_MANUAL_SHIFT_DURATIONS = [12, 6, 6] as const;
export const DEFAULT_MANUAL_SHIFT_START_TIME = "08:00";
export const MIN_MANUAL_SHIFT_COUNT = 2;
export const MAX_MANUAL_SHIFT_COUNT = 12;
// 配置窗口的步进器同样是 2–4 班。
export const MIN_MANUAL_SETUP_SHIFT_COUNT = MIN_MANUAL_SHIFT_COUNT;
export const MAX_MANUAL_SETUP_SHIFT_COUNT = 4;
