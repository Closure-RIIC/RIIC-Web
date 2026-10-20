import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });
const { agentLlmSettings, agentModelChoices } = await import("./config.ts");

test("model credentials are isolated; legacy configuration belongs only to the default provider", (t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  for (const key of Object.keys(process.env)) if (key.startsWith("AGENT_LLM_")) delete process.env[key];
  process.env.AGENT_LLM_PROVIDER = "deepseek";
  process.env.AGENT_LLM_API_KEY = "private-default-key";
  process.env.AGENT_LLM_BASE_URL = "https://gateway.test/v1";
  process.env.AGENT_LLM_MODEL = "deepseek-v4.1-flash";
  assert.equal(agentLlmSettings().configured, true);
  assert.equal(agentLlmSettings("glm").configured, false);
  assert.notEqual(agentLlmSettings("glm").baseURL, "https://gateway.test/v1");
  assert.deepEqual(agentModelChoices(), [{ id: "deepseek", label: "deepseek-v4.1-flash" }]);
  process.env.AGENT_LLM_GLM_API_KEY = "private-glm-key";
  process.env.AGENT_LLM_GLM_BASE_URL = "https://glm-gateway.test/v1";
  process.env.AGENT_LLM_GLM_MODEL = "glm-5.3-flash";
  assert.equal(agentLlmSettings("glm").apiKey, "private-glm-key");
  assert.equal(agentLlmSettings("glm").baseURL, "https://glm-gateway.test/v1");
  assert.deepEqual(agentModelChoices(), [{ id: "deepseek", label: "deepseek-v4.1-flash" }, { id: "glm", label: "glm-5.3-flash" }]);
  assert.doesNotMatch(JSON.stringify(agentModelChoices()), /private|gateway/);
  process.env.AGENT_LLM_DEEPSEEK_API_KEY = "explicit-key";
  assert.equal(agentLlmSettings().apiKey, "explicit-key");
});
