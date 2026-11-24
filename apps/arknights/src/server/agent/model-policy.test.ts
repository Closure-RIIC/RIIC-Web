import assert from "node:assert/strict";
import test from "node:test";
import { defaultModelPolicy, hasAgentImageBudget, MAX_AGENT_INPUT_TOKENS, parseModelPolicy, type AgentModelSelection } from "./model-policy.ts";
import { modelCallBudget } from "./model-budget.ts";

test("model policies preserve text capability and require an enabled default", () => {
  const policy = defaultModelPolicy();
  assert.equal(parseModelPolicy(policy).models.length, 3);
  assert.equal(policy.models[2].enabled, false);
  assert.equal(policy.models[2].imageTokensPerImage, 0);
  assert.throws(() => parseModelPolicy({ ...policy, defaultModel: "gpt" }));
  const invalid = structuredClone(policy); invalid.models[0].maxImages = 1;
  assert.throws(() => parseModelPolicy(invalid));
  assert.throws(() => parseModelPolicy({ ...policy, models: [policy.models[0], policy.models[0], policy.models[2]] }));
});

test("shared input reservation is an explicit vision policy and preserves legacy policies", () => {
  const policy = defaultModelPolicy();
  assert.equal(parseModelPolicy(policy).models[2].imageBudgetMode, undefined);
  assert.equal(hasAgentImageBudget(policy.models[2]), false);
  policy.models[2].imageBudgetMode = "shared-input-limit";
  assert.equal(parseModelPolicy(policy).models[2].imageTokensPerImage, 0);
  assert.equal(hasAgentImageBudget(policy.models[2]), true);
  assert.equal(hasAgentImageBudget({ ...policy.models[2], maxImages: 0 }), false);
  const invalid = structuredClone(policy); invalid.models[0].imageBudgetMode = "shared-input-limit";
  assert.throws(() => parseModelPolicy(invalid), /Text model/);
  const unknown = { ...policy, models: policy.models.map(row => row.id === "gpt" ? { ...row, imageBudgetMode: "unknown" } : row) };
  assert.throws(() => parseModelPolicy(unknown), /Invalid image budget mode/);
  policy.models[2].imageBudgetMode = "per-image";
  assert.equal(hasAgentImageBudget(parseModelPolicy(policy).models[2]), false);
  policy.models[2].imageTokensPerImage = 5000;
  assert.equal(hasAgentImageBudget(parseModelPolicy(policy).models[2]), true);
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
  assert.throws(() => modelCallBudget(selection, { prompt: [{ role: "system", content: "x".repeat(262_144) }] }));
  const nested = { ...request(1), tools: [{ type: "function" as const, name: "file_info", inputSchema: { type: "object" as const, example: { type: "file", mediaType: "image/png", data: "x".repeat(10_000) } } }] };
  assert.ok(modelCallBudget(selection, nested).inputTokens >= one.inputTokens + 10_000);
});

test("shared image requests reserve one total input limit while text requests keep their estimate", () => {
  const selection: AgentModelSelection = { ...defaultModelPolicy().models[2], enabled: true, imageBudgetMode: "shared-input-limit",
    provider: "riic-gpt", model: "gpt-6.1-sol", vision: true, protocol: "responses", policyVersion: "models:3" };
  const textRequest = { prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "Read this image" }] }], maxOutputTokens: 2048 };
  const plain = modelCallBudget(selection, textRequest);
  assert.equal(plain.inputTokens, Buffer.byteLength(JSON.stringify({ prompt: textRequest.prompt })) + 8192);
  assert.deepEqual(plain, modelCallBudget({ ...selection, imageBudgetMode: "per-image", imageTokensPerImage: 5000 }, textRequest));
  const request = (count: number, size = 1) => ({ ...textRequest, prompt: [{ role: "user" as const, content: [
    ...textRequest.prompt[0].content,
    ...Array.from({ length: count }, () => ({ type: "file" as const, mediaType: "image/png", data: { type: "data" as const, data: new Uint8Array(size) } })),
  ] }] });
  const expected = { provider: selection.provider, model: selection.model, inputTokens: MAX_AGENT_INPUT_TOKENS, maxOutputTokens: 2048 };
  assert.deepEqual(modelCallBudget(selection, request(1)), expected);
  assert.deepEqual(modelCallBudget(selection, request(4)), expected);
  assert.deepEqual(modelCallBudget(selection, request(1, 1_000_000)), expected);
  assert.throws(() => modelCallBudget(selection, request(5)), /Image budget/);
  assert.throws(() => modelCallBudget({ ...selection, maxImages: 0 }, request(1)), /Image budget/);
  assert.throws(() => modelCallBudget({ ...selection, vision: false }, request(1)), /Image budget/);
  assert.throws(() => modelCallBudget({ ...selection, imageBudgetMode: "per-image" }, request(1)), /Image budget/);
  const tooLong = request(1); tooLong.prompt[0].content[0] = { type: "text", text: "x".repeat(MAX_AGENT_INPUT_TOKENS) };
  assert.throws(() => modelCallBudget(selection, tooLong), /上下文过长/);
  const nested = { ...request(1), tools: [{ type: "function" as const, name: "file_info", inputSchema: {
    type: "object" as const, example: { type: "file", mediaType: "image/png", data: "x".repeat(MAX_AGENT_INPUT_TOKENS) },
  } }] };
  assert.throws(() => modelCallBudget(selection, nested), /上下文过长/);
});

test("text reservation accepts the input boundary and rejects the next byte in either mode", () => {
  const selection: AgentModelSelection = { ...defaultModelPolicy().models[2], enabled: true,
    provider: "riic-gpt", model: "gpt-6.1-sol", vision: true, protocol: "responses", policyVersion: "models:3" };
  const request = (size: number) => ({ prompt: [{ role: "system" as const, content: "x".repeat(size) }] });
  const textLength = MAX_AGENT_INPUT_TOKENS - modelCallBudget(selection, request(0)).inputTokens;
  for (const imageBudgetMode of [undefined, "per-image", "shared-input-limit"] as const) {
    assert.equal(modelCallBudget({ ...selection, imageBudgetMode }, request(textLength)).inputTokens, MAX_AGENT_INPUT_TOKENS);
    assert.throws(() => modelCallBudget({ ...selection, imageBudgetMode }, request(textLength + 1)), /上下文过长/);
  }
});
