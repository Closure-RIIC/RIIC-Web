/** Preserve text-table IDs outside JavaScript's safe integer range. */
export function parseLosslessJson(text) {
  return JSON.parse(text, (_key, value, context) =>
    typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value) ? context.source : value);
}
