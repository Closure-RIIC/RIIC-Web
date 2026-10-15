"use client";

import { INFRA_EVAL_MANIFEST_URL } from "./manifest";

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

type InfraEvalManifest = {
  api: string;
  ruleset: string;
  glueUrl: string;
  wasmUrl: string;
};

let bindingsPromise: Promise<WasmBindings> | null = null;
let manifestPromise: Promise<InfraEvalManifest> | null = null;

async function loadManifest(): Promise<InfraEvalManifest> {
  const response = await fetch(INFRA_EVAL_MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load WASM manifest (${response.status})`);
  const value = await response.json() as Partial<InfraEvalManifest>;
  if (typeof value.api !== "string" || typeof value.ruleset !== "string"
    || typeof value.glueUrl !== "string" || typeof value.wasmUrl !== "string") {
    throw new Error("WASM manifest is invalid");
  }
  return value as InfraEvalManifest;
}

async function loadGlueModule(url: string): Promise<WasmBindings> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load WASM glue (${response.status})`);
  const source = await response.text();
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ moduleUrl) as WasmBindings;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

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
    const manifest = await (manifestPromise ??= loadManifest().catch((error) => {
      manifestPromise = null;
      throw error;
    }));
    const module = await loadGlueModule(manifest.glueUrl);
    await module.default(manifest.wasmUrl);
    if (module.eval_api_version() !== manifest.api) {
      throw new Error(`WASM API mismatch: expected ${manifest.api}`);
    }
    return module;
  })().catch((error) => {
    bindingsPromise = null;
    throw error;
  }));

  const parsed: unknown = JSON.parse(bindings.evaluate_v1(JSON.stringify(request)));
  if (!validResponse(parsed)) throw new Error("WASM evaluator returned an invalid response");
  const manifest = await (manifestPromise ??= loadManifest());
  if (parsed.engine.api !== manifest.api || parsed.engine.ruleset !== manifest.ruleset) {
    throw new Error("WASM evaluator ruleset mismatch");
  }
  if (parsed.status === "error") {
    throw new Error(parsed.errors.map((error) => `[${error.code}] ${error.path}: ${error.message}`).join("\n"));
  }
  return parsed;
}
