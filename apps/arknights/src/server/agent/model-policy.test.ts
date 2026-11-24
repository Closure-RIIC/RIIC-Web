import assert from "node:assert/strict";
import test from "node:test";
import { defaultModelPolicy, hasAgentImageBudget, parseModelPolicy, type AgentModelSelection } from "./model-policy.ts";
import { modelCallBudget } from "./model-budget.ts";

test("model policies preserve text capability and require an enabled default", () => {
  const policy = defaultModelPolicy();
  assert.equal(parseModelPolicy(policy).models.length, 3);
  assert.equal(policy.models[2].enabled, false);
  assert.equal(policy.models[2].imageTokensPerImage, 8192);
  assert.throws(() => parseModelPolicy({ ...policy, defaultModel: "gpt" }));
  const invalid = structuredClone(policy); invalid.models[0].maxImages = 1;
  assert.throws(() => parseModelPolicy(invalid));
  assert.throws(() => parseModelPolicy({ ...policy, models: [policy.models[0], policy.models[0], policy.models[2]] }));
});

test("legacy shared snapshots normalize to per-image reservations without modifying history", () => {
  const policy = defaultModelPolicy();
  for (const previous of [0, 5000]) {
    const legacy = { ...policy, models: policy.models.map(row => row.id === "gpt" ? { ...row, imageBudgetMode: "shared-input-limit", imageTokensPerImage: previous } : row) };
    const original = structuredClone(legacy);
    const normalized = parseModelPolicy(legacy);
    assert.equal(normalized.models[2].imageTokensPerImage, 8192);
    assert.equal("imageBudgetMode" in normalized.models[2], false);
    assert.equal(hasAgentImageBudget(normalized.models[2]), true);
    assert.deepEqual(legacy, original);
  }
  const perImage = { ...policy, models: policy.models.map(row => row.id === "gpt" ? { ...row, imageBudgetMode: "per-image", imageTokensPerImage: 5000 } : row) };
  assert.equal(parseModelPolicy(perImage).models[2].imageTokensPerImage, 5000);
  const invalid = { ...policy, models: policy.models.map(row => row.id === "deepseek" ? { ...row, imageBudgetMode: "shared-input-limit" } : row) };
  assert.throws(() => parseModelPolicy(invalid), /Text model/);
  const unknown = { ...policy, models: policy.models.map(row => row.id === "gpt" ? { ...row, imageBudgetMode: "unknown" } : row) };
  assert.throws(() => parseModelPolicy(unknown), /Invalid image budget mode/);
});

test("administrators can raise image limits above the old constants, with integer and overflow checks", () => {
  const policy = defaultModelPolicy();
  Object.assign(policy.models[2], { maxImages: 8, maxImageBytes: 10 * 1024 * 1024, maxImagePixels: 32_000_000, imageTokensPerImage: 70000 });
  assert.deepEqual(parseModelPolicy(policy), policy);
  for (const key of ["maxImages", "maxImageBytes", "maxImagePixels", "imageTokensPerImage"] as const) {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = structuredClone(policy); invalid.models[2][key] = value;
      assert.throws(() => parseModelPolicy(invalid));
    }
  }
  const overflow = structuredClone(policy); overflow.models[2].maxImages = Number.MAX_SAFE_INTEGER;
  assert.throws(() => parseModelPolicy(overflow), /transport/);
  assert.equal(hasAgentImageBudget({ ...policy.models[2], imageTokensPerImage: 0 }), false);
  assert.equal(hasAgentImageBudget({ ...policy.models[2], maxImages: 0 }), false);
});

test("image budgets count each transmitted image without treating transport bytes as tokens", () => {
  const selection: AgentModelSelection = { ...defaultModelPolicy().models[2], enabled: true, imageTokensPerImage: 5000,
    provider: "riic-gpt", model: "gpt-6.1-sol", vision: true, protocol: "responses", policyVersion: "models:2" };
  const request = (size: number) => ({ prompt: [{ role: "user" as const, content: [
    { type: "text" as const, text: "Read this image" },
    { type: "file" as const, mediaType: "image/png", data: { type: "data" as const, data: new Uint8Array(size) } },
  ] }], maxOutputTokens: 2048 });
  assert.deepEqual(modelCallBudget(selection, request(1)), modelCallBudget(selection, request(1_000_000)));
  const one = modelCallBudget(selection, request(1));
  assert.equal(one.provider, "riic-gpt");
  const two = request(1); two.prompt[0].content.push(two.prompt[0].content[1]);
  assert.ok(modelCallBudget(selection, two).inputTokens >= one.inputTokens + 5000);
  assert.throws(() => modelCallBudget({ ...selection, vision: false }, request(1)));
  assert.throws(() => modelCallBudget({ ...selection, imageTokensPerImage: 0 }, request(1)));
  assert.ok(modelCallBudget(selection, { prompt: [{ role: "system", content: "x".repeat(262_144) }] }).inputTokens > 262_144);
  const nested = { ...request(1), tools: [{ type: "function" as const, name: "file_info", inputSchema: { type: "object" as const, example: { type: "file", mediaType: "image/png", data: "x".repeat(10_000) } } }] };
  assert.ok(modelCallBudget(selection, nested).inputTokens >= one.inputTokens + 10_000);
});

test("text plus each image is reserved, including requests exceeding the old shared cap", () => {
  const selection: AgentModelSelection = { ...defaultModelPolicy().models[2], enabled: true, maxImages: 8,
    provider: "riic-gpt", model: "gpt-6.1-sol", vision: true, protocol: "responses", policyVersion: "models:3" };
  const request = (count: number, text = "read this") => ({ prompt: [{ role: "user" as const, content: [
    { type: "text" as const, text },
    ...Array.from({ length: count }, () => ({ type: "file" as const, mediaType: "image/png", data: { type: "data" as const, data: new Uint8Array(1) } })),
  ] }], maxOutputTokens: 2048 });
  const plain = modelCallBudget(selection, request(0));
  assert.equal(plain.inputTokens, Buffer.byteLength(JSON.stringify({ prompt: request(0).prompt })) + 8192);
  const one = modelCallBudget(selection, request(1));
  assert.ok(one.inputTokens > plain.inputTokens + 8192);
  assert.ok(one.inputTokens < 18000);
  assert.equal(modelCallBudget({ ...selection, imageTokensPerImage: 10000 }, request(1)).inputTokens - one.inputTokens, 10000 - 8192);
  assert.ok(modelCallBudget(selection, request(8)).inputTokens < 80000);
  assert.throws(() => modelCallBudget(selection, request(9)), /Image budget/);
  assert.throws(() => modelCallBudget({ ...selection, maxImages: 0 }, request(1)), /Image budget/);
  assert.throws(() => modelCallBudget({ ...selection, imageTokensPerImage: Number.MAX_SAFE_INTEGER }, request(2)), /Invalid model token/);
  const longText = modelCallBudget(selection, request(1, "x".repeat(300000)));
  assert.ok(longText.inputTokens > 300000);
  const nested = { ...request(1), tools: [{ type: "function" as const, name: "file_info", inputSchema: {
    type: "object" as const, example: { type: "file", mediaType: "image/png", data: "x".repeat(300000) },
  } }] };
  assert.ok(modelCallBudget(selection, nested).inputTokens > 300000);
});
