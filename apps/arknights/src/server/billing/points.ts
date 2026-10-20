import { Decimal } from "decimal.js";
import { POINT_DECIMAL_PLACES } from "../../billing-points.ts";

/** Round once at settlement; wallet arithmetic stays on the same decimal grid. */
export function roundPoints(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(POINT_DECIMAL_PLACES, Decimal.ROUND_HALF_UP).toNumber();
}

export function sumPoints(...values: Decimal.Value[]): number {
  return roundPoints(values.reduce<Decimal>((sum, value) => sum.add(value), new Decimal(0)));
}

export function validPoints(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    && value <= 2_000_000_000 && new Decimal(value).decimalPlaces() <= POINT_DECIMAL_PLACES;
}

/** Allocate an already-rounded turn total without rounding each tool's share up. */
export function splitPoints(points: number, count: number, index: number): number {
  if (!validPoints(points) || !Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(index) || index < 0 || index >= count) throw new Error("Invalid point allocation");
  const units = new Decimal(points).mul(10 ** POINT_DECIMAL_PLACES).toNumber();
  return (Math.floor(units / count) + (index < units % count ? 1 : 0)) / 10 ** POINT_DECIMAL_PLACES;
}
