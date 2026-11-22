import assert from "node:assert/strict";
import test from "node:test";
import { agentCallerModels, buildAgentGatewayConfig, updateAgentGatewayEnv } from "./agent-model-gateway-config.mjs";

const existing = () => ({ revision: 7, providers: [
  { id: "custom", key: "unrelated-secret", models: ["custom-model"], chat: "https://custom.example/v1" },
  { id: "riic-deepseek", name: "Existing name", key: "deepseek-secret", models: ["deepseek-v4.1-flash"], chat: "https://ai.codesonline.dev/v1", maxRPM: 23, fallback: ["riic-glm/glm-5.3-flash"] },
  { id: "riic-glm", key: "glm-secret", models: ["glm-5.3-flash"], chat: "https://ai.codesonline.dev/v1" },
], groups: [{ id: "riic-agent", members: ["riic-deepseek/deepseek-v4.1-flash", "riic-glm/glm-5.3-flash"] }, { id: "unrelated", members: ["custom/custom-model"] }] });

test("existing two-model deployment upgrades idempotently and preserves unrelated configuration and credentials", () => {
  const before = existing(); const snapshot = globalThis.structuredClone(before);
  const plan = buildAgentGatewayConfig(before, {});
  assert.deepEqual(before, snapshot, "planning never mutates the source");
  assert.deepEqual(plan.models, ["deepseek", "glm"]);
  assert.deepEqual(plan.routes, ["riic-deepseek/deepseek-v4.1-flash", "riic-glm/glm-5.3-flash"]);
  assert.deepEqual(plan.config.providers[0], before.providers[0]);
  assert.equal(plan.config.providers[1].key, "deepseek-secret");
  assert.equal(plan.config.providers[1].maxRPM, 23);
  assert.equal(plan.config.providers[1].fallback, undefined);
  assert.deepEqual(plan.config.groups[0], { ...before.groups[0], name: "RIIC Agent", routing: "order", affinity: "turn", firstToken: 10, patience: -1 });
  assert.deepEqual(plan.config.groups[1], before.groups[1]);
  assert.deepEqual(buildAgentGatewayConfig(plan.config, {}), plan);
});

test("managed default group drops all legacy routing and visibility controls before adding official fallback", () => {
  const before = existing();
  const legacy = { name: "Existing Agent", match: ["riic-gpt/*"], matched: ["riic-gpt/gpt-6.1-sol"],
    routing: "manual", affinity: "session", sink: true, firstToken: 0, patience: 240,
    off: ["riic-deepseek/deepseek-v4.1-flash"], pick: "riic-gpt/gpt-6.1-sol",
    rules: [{ member: "riic-gpt/gpt-6.1-sol" }], classifier: "riic-gpt/gpt-6.1-sol", effort: "auto",
    context: 1, levels: ["high"], fast: ["riic-deepseek/deepseek-v4.1-flash"], family: "hidden-family",
    auto: true, hidden: true, disabled: true, futureRoutingControl: "unexpected" };
  Object.assign(before.groups[0], legacy);
  Object.assign(before.groups[1], legacy);
  const snapshot = globalThis.structuredClone(before);
  const source = { AGENT_LLM_GPT_API_KEY: "gpt-test-only", AGENT_LLM_GPT_BASE_URL: "https://ai.codesonline.dev/v1", AGENT_LLM_GPT_MODEL: "gpt-6.1-sol",
    AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED: "1", AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY: "official-test-only",
    AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL: "https://api.deepseek.com", AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL: "deepseek-flash" };
  const plan = buildAgentGatewayConfig(before, source);
  assert.deepEqual(plan.config.groups[0], { id: "riic-agent", name: "Existing Agent", routing: "order", affinity: "turn", firstToken: 10, patience: -1,
    members: ["riic-deepseek/deepseek-v4.1-flash", "riic-glm/glm-5.3-flash", "riic-deepseek-official/deepseek-flash"] });
  assert.deepEqual(before, snapshot, "planning never mutates source state");
  assert.deepEqual(plan.config.groups[1], before.groups[1], "unrelated groups keep every control");
  assert.deepEqual(buildAgentGatewayConfig(plan.config, source), plan, "migration is idempotent");
  before.groups[0].off = true;
  assert.deepEqual(buildAgentGatewayConfig(before, source).config.groups[0], plan.config.groups[0], "obsolete malformed controls are also removed");
});

test("GPT is enabled only with its complete independent configuration and has only Responses upstream", () => {
  const partial = { AGENT_LLM_GPT_BASE_URL: "https://ai.codesonline.dev/v1", AGENT_LLM_GPT_MODEL: "gpt-6.1-sol", AGENT_LLM_API_KEY: "legacy-other-secret" };
  assert.deepEqual(buildAgentGatewayConfig(existing(), partial).models, ["deepseek", "glm"]);
  const plan = buildAgentGatewayConfig(existing(), { ...partial, AGENT_LLM_GPT_API_KEY: "gpt-secret" });
  assert.deepEqual(plan.models, ["deepseek", "glm", "gpt"]);
  const gpt = plan.config.providers.find(provider => provider.id === "riic-gpt");
  assert.equal(gpt.responses, "https://ai.codesonline.dev/v1");
  assert.equal(gpt.key, "gpt-secret"); assert.equal(gpt.chat, undefined);
  assert.equal(plan.routes[2], "riic-gpt/gpt-6.1-sol");
  const previous = globalThis.structuredClone(plan.config);
  Object.assign(previous.providers.at(-1), { chat: "https://wrong.example/v1", anthropic: "https://wrong.example", fallback: ["riic-glm/glm-5.3-flash"] });
  const upgraded = buildAgentGatewayConfig(previous, {}).config.providers.at(-1);
  assert.equal(upgraded.chat, undefined); assert.equal(upgraded.anthropic, undefined); assert.equal(upgraded.fallback, undefined);
});

test("new installations honor only the configured default provider's legacy credentials", () => {
  const source = { AGENT_LLM_PROVIDER: "glm", AGENT_LLM_BASE_URL: "https://ai.codesonline.dev/v1", AGENT_LLM_MODEL: "glm-5.3-flash", AGENT_LLM_API_KEY: "glm-secret",
    AGENT_LLM_DEEPSEEK_BASE_URL: "https://ai.codesonline.dev/v1", AGENT_LLM_DEEPSEEK_MODEL: "deepseek-v4.1-flash", AGENT_LLM_DEEPSEEK_API_KEY: "deepseek-secret" };
  const plan = buildAgentGatewayConfig({}, source);
  assert.equal(plan.config.providers[0].key, "deepseek-secret"); assert.equal(plan.config.providers[1].key, "glm-secret");
  delete source.AGENT_LLM_DEEPSEEK_API_KEY;
  assert.throws(() => buildAgentGatewayConfig({}, source), /Complete enabled DeepSeek/);
});

test("caller allowlist retains the managed group and replaces obsolete managed routes", () => {
  const routes = buildAgentGatewayConfig(existing(), {}).routes;
  const actual = agentCallerModels(["group/riic-agent", "riic-deepseek/*", "riic-glm/old", "unrelated/model"], routes);
  assert.deepEqual(actual, ["unrelated/model", "group/riic-agent", ...routes]);
  assert.deepEqual(agentCallerModels(actual, routes), actual);
  assert.deepEqual(agentCallerModels(undefined, routes), ["group/riic-agent", ...routes], "an unrestricted old application key becomes restricted");
});

test("only DeepSeek is required and GPT never joins the default fallback group", () => {
  const before = existing(); before.providers = before.providers.filter(provider => provider.id !== "riic-glm");
  const source = { AGENT_LLM_GPT_API_KEY: "gpt-test-only", AGENT_LLM_GPT_BASE_URL: "https://ai.codesonline.dev/v1", AGENT_LLM_GPT_MODEL: "gpt-6.1-sol" };
  const plan = buildAgentGatewayConfig(before, source);
  assert.deepEqual(plan.models, ["deepseek", "gpt"]);
  assert.deepEqual(plan.config.groups[0].members, ["riic-deepseek/deepseek-v4.1-flash"]);
  assert.equal(plan.officialEnabled, false);
  assert.deepEqual(plan.routes, ["riic-deepseek/deepseek-v4.1-flash", "riic-gpt/gpt-6.1-sol"]);
});

test("official fallback needs its explicit flag and complete separate configuration", () => {
  const source = { AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED: "1", AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY: "official-test-only",
    AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL: "https://api.deepseek.com", AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL: "deepseek-flash" };
  const plan = buildAgentGatewayConfig(existing(), source);
  assert.equal(plan.officialEnabled, true);
  assert.deepEqual(plan.models, ["deepseek", "glm"]);
  assert.deepEqual(plan.config.groups[0].members, [...plan.routes]);
  assert.equal(plan.routes.at(-1), "riic-deepseek-official/deepseek-flash");
  assert.equal(plan.modelEnvironment.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL, "deepseek-flash");
  assert.equal(plan.config.providers.at(-1).key, "official-test-only");
  assert.deepEqual(buildAgentGatewayConfig(plan.config, { AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED: "1" }), plan, "existing private credentials are reused");
  const disabled = buildAgentGatewayConfig(plan.config, { AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED: "0" });
  assert.equal(disabled.officialEnabled, false);
  assert.ok(!disabled.config.groups[0].members.some(route => route.startsWith("riic-deepseek-official/")));
  assert.equal(disabled.config.providers.at(-1).key, "official-test-only", "disabling preserves the credential for an explicit rollback");
  assert.equal(buildAgentGatewayConfig(existing(), { ...source, AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY: "" }).officialEnabled, false);
  assert.equal(buildAgentGatewayConfig(existing(), { ...source, AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED: "0" }).officialEnabled, false);
  assert.throws(() => buildAgentGatewayConfig(existing(), { ...source, AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL: "https://other.example" }), /Supplemental/);
});

test("official fallback also supports a DeepSeek-only primary group and preserves unrelated state", () => {
  const before = existing(); before.providers = before.providers.filter(provider => provider.id !== "riic-glm");
  before.providers.push({ id: "riic-deepseek-official", name: "Existing official", key: "official-test-only", chat: "https://api.deepseek.com/v1", models: ["deepseek-flash"], maxRPM: 17 });
  const plan = buildAgentGatewayConfig(before, { AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED: "1" });
  assert.deepEqual(plan.config.groups[0].members, ["riic-deepseek/deepseek-v4.1-flash", "riic-deepseek-official/deepseek-flash"]);
  assert.equal(plan.config.providers.at(-1).maxRPM, 17);
  assert.equal(plan.config.providers.at(-1).name, "Existing official");
  assert.deepEqual(agentCallerModels(["riic-deepseek-official/old", "group/riic-agent", "custom/model"], plan.routes), ["custom/model", "group/riic-agent", ...plan.routes]);
});

test("published application model identities exactly match custom gateway routes without exporting credentials", () => {
  const source = { AGENT_LLM_DEEPSEEK_MODEL: "deepseek-custom", AGENT_LLM_GLM_MODEL: "glm-custom",
    AGENT_LLM_GPT_MODEL: "gpt-custom", AGENT_LLM_GPT_BASE_URL: "https://ai.codesonline.dev/v1", AGENT_LLM_GPT_API_KEY: "gpt-secret" };
  const plan = buildAgentGatewayConfig(existing(), source);
  assert.deepEqual(plan.modelEnvironment, { AGENT_LLM_DEEPSEEK_MODEL: "deepseek-custom", AGENT_LLM_GLM_MODEL: "glm-custom", AGENT_LLM_GPT_MODEL: "gpt-custom" });
  assert.deepEqual(plan.routes, ["riic-deepseek/deepseek-custom", "riic-glm/glm-custom", "riic-gpt/gpt-custom"]);
  const text = updateAgentGatewayEnv('AGENT_LLM_GLM_MODEL="stale-model"\n', { AGENT_GATEWAY_MODELS: plan.models.join(","), ...plan.modelEnvironment });
  assert.match(text, /AGENT_LLM_GLM_MODEL="glm-custom"/);
  assert.match(text, /AGENT_LLM_GPT_MODEL="gpt-custom"/);
  assert.doesNotMatch(text, /secret|BASE_URL|API_KEY|stale-model/);
});

test("environment readiness update preserves enabled state, secrets and unrelated lines", () => {
  const before = '# private\nAGENT_GATEWAY_ENABLED="1"\nAGENT_GATEWAY_KEY="keep-secret"\nLOCAL_VALUE=kept\n';
  const changes = { AGENT_GATEWAY_MODELS: "deepseek,glm,gpt" };
  const after = updateAgentGatewayEnv(before, changes);
  assert.ok(after.startsWith(before)); assert.match(after, /AGENT_GATEWAY_MODELS="deepseek,glm,gpt"/);
  assert.equal(updateAgentGatewayEnv(after, changes), after);
  assert.throws(() => updateAgentGatewayEnv("AGENT_GATEWAY_MODELS=a\nAGENT_GATEWAY_MODELS=b\n", changes), /Duplicate/);
});

test("malformed and duplicate managed configuration fails closed", () => {
  assert.throws(() => buildAgentGatewayConfig({ providers: {} }, {}), /Invalid/);
  const duplicate = existing(); duplicate.providers.push(duplicate.providers[1]);
  assert.throws(() => buildAgentGatewayConfig(duplicate, {}), /Duplicate/);
  assert.throws(() => buildAgentGatewayConfig(existing(), { AGENT_LLM_GPT_BASE_URL: "https://user:secret@example.com/v1", AGENT_LLM_GPT_API_KEY: "gpt-secret", AGENT_LLM_GPT_MODEL: "gpt-6.1-sol" }), /Invalid upstream URL/);
});
