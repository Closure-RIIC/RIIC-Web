/** 默认每分钟采样；可以在模拟设置中调整精度。 */
export const SIM_SAMPLE_SECONDS = 60;

/** 可选的模拟总时长（小时）。 */
export const SIM_HOURS = [24, 48, 72, 96] as const;

/** 可选的播放倍率。 */
export const SIM_SPEEDS = [1, 10, 100, 1000] as const;
