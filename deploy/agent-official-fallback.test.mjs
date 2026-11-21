import assert from "node:assert/strict";
import test from "node:test";
import { withOfficialDeepSeekFallback } from "./agent-official-fallback.mjs";

const source = { AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY: "official-test-only",
  AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL: "https://api.deepseek.com", AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL: "deepseek-flash" };
const config = { providers: [{ id: "riic-deepseek", key: "primary-test-only", queueWait: 15 }, { id: "riic-glm", key: "glm-test-only", queueWait: 15 }],
  groups: [{ id: "riic-agent", members: ["riic-deepseek/deepseek-v4.1-flash", "riic-glm/glm-5.3-flash"], routing: "order", affinity: "turn" }] };

test("official endpoint is last, has isolated credentials and bounded pre-content waits", () => {
  const next = withOfficialDeepSeekFallback(config, source);
  assert.deepEqual(next.groups[0].members, [...config.groups[0].members, "riic-deepseek-official/deepseek-flash"]);
  assert.equal(next.groups[0].firstToken, 10);
  assert.equal(next.groups[0].patience, -1);
  assert.ok(next.providers.every(row => row.queueWait === 1));
  assert.equal(next.providers[0].key, "primary-test-only");
  assert.equal(next.providers[2].key, "official-test-only");
  assert.equal(next.providers[2].chat, "https://api.deepseek.com");
  assert.equal(config.providers.length, 2, "input config is preserved for backup/diff");
  assert.deepEqual(withOfficialDeepSeekFallback(next, source), next, "reapplying is idempotent");
});

test("unexpected routing, model and endpoint cannot silently receive the official key", () => {
  assert.throws(() => withOfficialDeepSeekFallback(config, { ...source, AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL: "https://other.test/v1" }));
  assert.throws(() => withOfficialDeepSeekFallback(config, { ...source, AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY: "" }));
  assert.throws(() => withOfficialDeepSeekFallback(config, { ...source, AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL: "other-model" }));
  assert.throws(() => withOfficialDeepSeekFallback({ ...config, groups: [{ ...config.groups[0], members: config.groups[0].members.toReversed() }] }, source));
  assert.throws(() => withOfficialDeepSeekFallback({ ...config, providers: [config.providers[0]] }, source));
});
