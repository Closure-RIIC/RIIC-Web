const WAN = 10_000;

/**
 * 中文按"万/亿"口语刻度缩写大数：万位保留一位小数（193200 → "19.3万"），
 * 亿位起保留两位小数（190002000 → "1.90亿"）。英文用 compact 记法。
 * 小于 1 万的数值返回 null，由调用方保留原样展示。
 */
export function formatScaledAmount(value: number, locale: "zh" | "en" = "zh"): string | null {
  if (!Number.isFinite(value) || value < WAN) return null;
  if (locale === "en") {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  const yi = Math.round(value / 1_000_000) / 100;
  if (yi >= 1) return `${yi.toFixed(2)}亿`;
  return `${(value / WAN).toFixed(1).replace(/\.0$/, "")}万`;
}
