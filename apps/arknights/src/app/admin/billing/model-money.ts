import { Decimal } from "decimal.js";

/** Keep database decimal precision until the final display rounding. */
export function formatModelMoney(value: string) {
  return new Decimal(value).toFixed(8);
}
