import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import { defaultRatePolicy } from "./rate-policy.ts";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });

test("unpublished rates block model access while the admin editor remains available", async t => {
  type PolicyRow = { id: string; kind: string; status: string; payload: unknown; version?: number; created_at?: string };
  const rows: PolicyRow[] = [];
  const mutations: string[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
    if (sql.startsWith("INSERT INTO app.agent_policy_version")) {
      mutations.push(sql);
      if (sql.includes("'filter:1'")) {
        if (!rows.some(row => row.kind === "filter")) rows.push({ id: "filter:1", kind: "filter", status: "active", payload: JSON.parse(String(values[0])), version: 1, created_at: new Date().toISOString() });
      } else if (sql.includes("'models:'")) {
        if (!rows.some(row => row.kind === "models" && row.status === "active")) rows.push({ id: "models:1", kind: "models", status: "active", payload: JSON.parse(String(values[0])), version: 1, created_at: new Date().toISOString() });
      } else {
        assert.equal(values[1], "model-settings", "reads never create rate versions");
        rows.push({ id: String(values[0]), kind: String(values[1]), version: Number(values[2]), payload: JSON.parse(String(values[3])), status: "draft", created_at: new Date().toISOString() });
      }
      return { rows: [] };
    }
    if (sql.startsWith("SELECT coalesce(max(version),0)+1")) return { rows: [{ version: 1 + Math.max(0, ...rows.filter(row => row.kind === values[0]).map(row => row.version ?? 0)) }] };
    if (sql.startsWith("UPDATE app.agent_policy_version SET status='retired'")) {
      for (const row of rows) if (row.kind === "model-settings" && row.status === "active") row.status = "retired";
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE app.agent_policy_version SET status='active'")) {
      rows.find(row => row.id === values[0])!.status = "active"; return { rows: [] };
    }
    if (sql.startsWith("SELECT id,kind")) return { rows: structuredClone(rows.filter(row => row.status === "active")) };
    if (sql.startsWith("SELECT * FROM (")) return { rows: structuredClone(rows.filter(row => row.kind !== "model-settings")) };
    if (sql.startsWith("SELECT * FROM app.agent_policy_version")) return { rows: structuredClone(rows.filter(row => row.kind === "model-settings" && (!sql.includes("status='active'") || row.status === "active"))) };
    if (sql.startsWith("SELECT * FROM app.agent_gateway_status")) return { rows: [] };
    throw new Error(`Unexpected database operation: ${sql}`);
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  await t.mock.module(new URL("../../../../../packages/platform-server/src/db/index.ts", import.meta.url), { namedExports: { getDatabasePool: () => pool } });
  const { activeAgentPolicies, AgentAccountingError } = await import("./agent-accounting.ts");
  const { getAgentPolicies } = await import("./admin.ts");

  const initial = await getAgentPolicies();
  assert.equal(initial.initialRates.markup, "");
  assert.equal(initial.modelSettings.active, null);
  assert.equal(initial.modelSettings.initialPayload.rates.markup, "");
  assert.deepEqual(initial.modelSettings.expectedActive, { ratesId: null, modelsId: "models:1" });
  assert.ok(initial.models.every(row => !row.available));
  assert.equal(initial.versions.some(row => row.kind === "rates"), false);
  await assert.rejects(activeAgentPolicies(), error => error instanceof AgentAccountingError && error.code === "policy_unavailable");
  assert.equal(rows.some(row => row.kind === "rates"), false);

  const existing = { id: "rates:7", kind: "rates", status: "active", payload: defaultRatePolicy("1.45"), version: 7, created_at: new Date().toISOString() };
  rows.push(existing);
  const before = structuredClone(existing);
  const active = await activeAgentPolicies();
  assert.equal(active.rates.id, existing.id);
  assert.equal(active.rates.policy.markup, "1.45");
  await getAgentPolicies();
  assert.deepEqual(existing, before, "runtime and admin reads retain the stored active version");
  assert.ok(mutations.every(sql => !sql.includes("'rates'")));

  existing.payload.markup = "";
  await assert.rejects(activeAgentPolicies(), error => error instanceof AgentAccountingError && error.code === "policy_unavailable");
  assert.equal((await getAgentPolicies()).versions.some(row => row.id === existing.id), true, "invalid active rates remain available for administrator repair");
});
