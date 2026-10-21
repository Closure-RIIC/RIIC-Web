export const POINT_DECIMAL_PLACES = 4;
export const MIN_POINT_AMOUNT = 0.0001;

export function formatPoints(points: number, locale = "zh-CN"): string {
  return points.toLocaleString(locale, { maximumFractionDigits: POINT_DECIMAL_PLACES });
}
