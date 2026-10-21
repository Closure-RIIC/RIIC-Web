import assert from "node:assert/strict";
import test from "node:test";

import { parseTrainingAdviceReport } from "../training-advice-contract.ts";

function completeReport() {
  return {
    schema_version: 2,
    context: {
      has_originium_shard_factory: true,
      engineering_robot_count: 12,
      stdout: "private context",
    },
    newbie_section_status: "shown",
    incomplete_newbie: [{
      operator: "芬",
      product: "trade",
      action: "train",
      current: { elite: 0, level: 30, command: "private state" },
      target: { kind: "explicit", elite: 1, level: 1, solver: { private: true } },
      acquisition: null,
      stderr: "private newbie",
    }],
    combinations: [{
      id: "combo",
      name: "测试组合",
      product: "originium_shards",
      consumer_products: ["gold"],
      tier: "high_efficiency",
      scale: "small",
      facilities: ["manufacturing_station"],
      state: "needs_review",
      completed_slots: 0,
      total_slots: 1,
      completion_percent: 0,
      missing_core: ["泡泡"],
      selected_alternative: 0,
      members: [{
        operator: "泡泡",
        role: "core",
        progress: "needs_review",
        owned: false,
        target_met: false,
        target: { kind: "needs_review", elite: null, level: null },
        counts_toward_completion: true,
        command: "private member",
      }],
      debugBundle: { private: true },
    }],
    recommendations: [{
      operator: "泡泡",
      action: "acquire",
      target: { kind: "no_requirement", elite: null, level: null },
      priority: "high_efficiency_standalone",
      priority_rank: 100,
      reason: "standalone",
      product: "originium_shards",
      efficiency: { value: 20, unit: "production_percent", note: null, stdout: "private" },
      conditions: [{
        condition: {
          kind: "custom",
          key: "fixture",
          value: {
            visible: true,
            command: "private",
            candidates: ["private"],
            serverRequest: { private: true },
            nested: { solver: "private" },
          },
          description: "测试条件",
          cliPath: "private",
        },
        status: "unknown",
      }],
      acquisition: { kind: "event", detail: "活动获取", stderr: "private" },
      solver: { private: true },
    }],
    command: "private top level",
    stdout: "private top level",
    unknown_future_field: true,
  };
}

function keysDeep(value: unknown, keys = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    keysDeep(child, keys);
  }
  return keys;
}

test("parses and recursively whitelists the complete training advice v2 contract", () => {
  const parsed = parseTrainingAdviceReport(completeReport());
  assert.equal(parsed.schema_version, 2);
  assert.equal(parsed.newbie_section_status, "shown");
  assert.equal(parsed.combinations[0].state, "needs_review");
  assert.equal(parsed.combinations[0].members[0].progress, "needs_review");
  assert.deepEqual(parsed.recommendations[0].conditions?.[0].condition.value, {
    visible: true,
    nested: {},
  });

  const keys = keysDeep(parsed);
  for (const forbidden of [
    "command",
    "stdout",
    "stderr",
    "cliPath",
    "debugBundle",
    "solver",
    "serverRequest",
    "candidates",
    "unknown_future_field",
  ]) {
    assert.equal(keys.has(forbidden), false, `must not expose ${forbidden}`);
  }
});

test("rejects malformed or incompatible training advice reports", () => {
  for (const [label, mutate] of [
    ["schema", (value: ReturnType<typeof completeReport>) => { value.schema_version = 3; }],
    ["array", (value: ReturnType<typeof completeReport>) => { value.recommendations = {} as never; }],
    ["enum", (value: ReturnType<typeof completeReport>) => { value.newbie_section_status = "future"; }],
    ["nested", (value: ReturnType<typeof completeReport>) => { value.combinations[0].members[0].owned = "yes" as never; }],
  ] as const) {
    const value = completeReport();
    mutate(value);
    assert.throws(() => parseTrainingAdviceReport(value), label);
  }
  assert.throws(() => parseTrainingAdviceReport([]), /必须是对象/);
});
