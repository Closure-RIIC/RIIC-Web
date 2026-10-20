/** 基建报表（副手简报）产出指标的键，与账号体检 HealthDailyReport 的字段对齐。 */
export type ReportMetricKey = "experience" | "goldValue" | "lmd" | "orderCount" | "orundum";

export const REPORT_METRIC_KEYS: readonly ReportMetricKey[] = ["experience", "goldValue", "lmd", "orderCount", "orundum"] as const;

/** 单个面板（一天）的识别结果；识别失败或缺行的指标为 undefined。 */
export type RecognizedMetric = { value: number; maxDistance: number };

export type RecognizedDay = Partial<Record<ReportMetricKey, RecognizedMetric>>;

/** 常规匹配距离阈值以下视为可信；超过则界面提示人工复核。 */
export const RECOGNITION_CONFIDENT_DISTANCE = 0.2;

export type ReportRecognitionResult = {
  /** 检测到的面板数量：3=三日报表，1=单日报表。 */
  panelCount: number;
  /** 依据截图比例选择的版式参数。 */
  profile: "standard" | "wide-strip" | "fallback";
  kind: "three-day" | "single-day";
  /** 按游戏界面从左到右的顺序；三日时最右列是最新一天。 */
  days: RecognizedDay[];
  /** 机器可读的警告键，界面据此提示。 */
  warnings: Array<"single-day-report" | "odd-aspect-ratio" | "low-resolution" | "panel-mismatch">;
};

export type ReportRecognitionFailure = { ok: false; reason: "no-panel" | "decode" };

export type ReportRecognitionOutcome = ReportRecognitionResult | ReportRecognitionFailure;
