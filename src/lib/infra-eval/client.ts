"use client";

import { INFRA_EVAL_MANIFEST } from "./manifest";

export type NativeEvalAssignedOperator = {
  name: string;
  work_mood?: number;
};

export type NativeEvalShift = {
  duration_hours: number;
  rooms: Array<{ room_id: string; operators: NativeEvalAssignedOperator[]; product?: unknown }>;
  training_assist?: NativeEvalAssignedOperator;
};

export type NativeEvalRequestV1 = {
  schema_version: 1;
  layout: unknown;
  scheduled_operators: Array<{
    id: string;
    name: string;
    elite: number;
    level: number;
    own: boolean;
    potential: number;
    rarity: number;
  }>;
  shifts: NativeEvalShift[];
};

type NativeEvalBreakdown = {
  occupancy_basis_points: number;
  skill_basis_points: number;
  global_basis_points: number;
  order_multiplier_basis_points: number;
  trade_equivalent_basis_points: number;
  gold_equivalent_basis_points: number;
  combined_output_value_basis_points: number;
};

type NativeEvalRoom = {
  room_id: string;
  facility: string;
  level: number;
  settlement_status: "evaluated" | "not_supported";
  display_base_basis_points: number;
  display_skill_basis_points: number;
  display_global_basis_points: number;
  display_total_basis_points: number;
  display_final_basis_points: number;
  order_multiplier_basis_points: number;
  trade_equivalent_basis_points: number;
  gold_equivalent_basis_points: number;
  total_basis_points: number;
  final_basis_points: number;
  breakdown: NativeEvalBreakdown | null;
};

type NativeEvalTotals = {
  trade_total_basis_points: number;
  trade_final_basis_points: number;
  manufacture_basis_points: number;
  power_basis_points: number;
  office_speed_percent: number;
  meeting_speed_percent: number;
};

export type NativeEvalResponseV1 = {
  schema_version: 1;
  status: "ok";
  engine: { api: string; ruleset: string };
  shifts: Array<{ index: number; duration_hours: number; totals: NativeEvalTotals; rooms: NativeEvalRoom[] }>;
  weighted: NativeEvalTotals;
  diagnostics: Array<{ code: string; path: string; message: string }>;
};

type NativeEvalErrorResponseV1 = {
  schema_version: 1;
  status: "error";
  engine: { api: string; ruleset: string };
  errors: Array<{ code: string; path: string; message: string }>;
};

type WasmBindings = {
  default: (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module) => Promise<unknown>;
  eval_api_version: () => string;
  evaluate_v1: (request: string) => string;
};

let bindingsPromise: Promise<WasmBindings> | null = null;

function validResponse(value: unknown): value is NativeEvalResponseV1 | NativeEvalErrorResponseV1 {
  if (!value || typeof value !== "object") return false;
  const response = value as { schema_version?: unknown; status?: unknown; engine?: { api?: unknown; ruleset?: unknown } };
  return response.schema_version === 1
    && (response.status === "ok" || response.status === "error")
    && typeof response.engine?.api === "string"
    && typeof response.engine?.ruleset === "string";
}

export async function evaluateNativeSchedule(request: NativeEvalRequestV1): Promise<NativeEvalResponseV1> {
  const bindings = await (bindingsPromise ??= (async () => {
    const glueUrl = "/wasm/infra_eval_wasm.js";
    const module = await import(/* webpackIgnore: true */ glueUrl) as WasmBindings;
    await module.default(INFRA_EVAL_MANIFEST.wasmUrl);
    if (module.eval_api_version() !== INFRA_EVAL_MANIFEST.api) {
      throw new Error(`WASM API mismatch: expected ${INFRA_EVAL_MANIFEST.api}`);
    }
    return module;
  })().catch((error) => {
    bindingsPromise = null;
    throw error;
  }));

  const parsed: unknown = JSON.parse(bindings.evaluate_v1(JSON.stringify(request)));
  if (!validResponse(parsed)) throw new Error("WASM evaluator returned an invalid response");
  if (parsed.engine.api !== INFRA_EVAL_MANIFEST.api || parsed.engine.ruleset !== INFRA_EVAL_MANIFEST.ruleset) {
    throw new Error("WASM evaluator ruleset mismatch");
  }
  if (parsed.status === "error") {
    throw new Error(parsed.errors.map((error) => `[${error.code}] ${error.path}: ${error.message}`).join("\n"));
  }
  return parsed;
}
