import { createHmac } from "node:crypto";

import type { BaseBlueprint, OperBoxEntry } from "../types.ts";

export type StablePlanCacheKeyInput = {
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  sourceType: "sample" | "maa" | "skland";
  sourceName: string;
  rotation: string;
  fiammettaEnable: boolean;
  solverExecutableSha256: string;
  protocolVersion: number;
  planSchemaVersion: number;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stablePlanCacheHmac(key: Buffer, input: StablePlanCacheKeyInput): string {
  if (key.byteLength < 32) throw new Error("Plan cache HMAC key must contain at least 32 bytes.");
  return createHmac("sha256", key).update(canonical(input)).digest("hex");
}
