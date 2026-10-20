export const MOTION_EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const MOTION_EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const MOTION_EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

export const MOTION_DURATION = {
  feedback: 0.14,
  press: 0.16,
  fast: 0.18,
  state: 0.26,
  content: 0.28,
  emphasis: 0.32,
} as const;

export const MOTION_TRANSITION = {
  fast: { duration: MOTION_DURATION.fast, ease: MOTION_EASE_OUT },
  state: { duration: MOTION_DURATION.state, ease: MOTION_EASE_OUT },
  content: { duration: MOTION_DURATION.content, ease: MOTION_EASE_OUT },
  emphasis: { duration: MOTION_DURATION.emphasis, ease: MOTION_EASE_OUT },
} as const;

export type ShiftDirection = -1 | 0 | 1;
