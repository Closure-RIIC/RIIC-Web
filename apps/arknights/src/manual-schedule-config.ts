export const MANUAL_SCHEDULE_STORAGE_KEY = "arknights-infra-manual-schedule-v1";
export const MOOD_STORAGE_KEY = "riic.manual-mood.v1";
export const DEFAULT_MANUAL_SHIFT_DURATIONS = [12, 6, 6] as const;
export const DEFAULT_MANUAL_SHIFT_START_TIME = "08:00";
export const MIN_MANUAL_SHIFT_COUNT = 1;
export const MAX_MANUAL_SHIFT_COUNT = 12;
// The setup stepper creates up to three shifts. Keep the storage/import limit
// separate so opening an older schedule never discards its assignments.
export const MAX_MANUAL_SETUP_SHIFT_COUNT = 3;
