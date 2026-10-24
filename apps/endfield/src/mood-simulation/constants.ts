/** 心情模拟区固定每分钟一个采样点；横轴时长与播放倍率由界面下拉选择。 */
export const SIM_SAMPLE_SECONDS = 60;

/** 可选的模拟总时长（小时）。 */
export const SIM_HOURS = [24, 48, 72, 96] as const;

/** 可选的播放倍率。 */
export const SIM_SPEEDS = [1, 10, 100, 1000] as const;
