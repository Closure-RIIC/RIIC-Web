import assert from "node:assert/strict";
import test from "node:test";
import { compileFilterPolicy, createFilteredTextBuffer, gatewayFilterOptions, parseFilterPolicy } from "./filter-policy.ts";
const policy = { rules: [{ id: "test", text: "secret", kind: "word" as const, enabled: true }], allow: [] };
test("normalization, exact allow spans and bounded patterns", () => {
  const filter = compileFilterPolicy(policy);
  assert.throws(() => filter.assert("ＳＥＣ\u200bＲＥＴ"));
  assert.equal(filter.mask("a secret b").text, "a *** b");
  const allowed = compileFilterPolicy({ ...policy, allow: ["secret garden"] });
  assert.equal(allowed.mask("secret garden / secret").text, "secret garden / ***");
  assert.throws(() => parseFilterPolicy({ ...policy, rules: [{ ...policy.rules[0], kind: "pattern", text: "(a+)+" }] }));
  assert.throws(() => compileFilterPolicy({ ...policy, rules: [{ ...policy.rules[0], kind: "pattern", text: "key=????" }] }).assert("key=1234"));
  assert.deepEqual(gatewayFilterOptions({ ...policy, allow: ["secret garden"] }).words, []);
});
test("all chunk boundaries produce the same masked text, including normalization and emoji", () => {
  const filter = compileFilterPolicy(policy);
  for (const text of ["hello secret world 🐱", "a ＳＥＣ\u200bＲＥＴ b", "secretsecret", "prefix e\u0301 secret tail"]) {
    for (let split = 0; split <= text.length; split++) {
      const buffer = createFilteredTextBuffer(filter);
      const output = buffer.push(text.slice(0, split)) + buffer.push(text.slice(split)) + buffer.push("", true);
      assert.equal(output, filter.mask(text).text, `split=${split}`);
    }
  }
});
test("one-code-unit chunks, allow spans, and aborted tails never leak a match", () => {
  const filter = compileFilterPolicy({ ...policy, allow: ["secret garden"] });
  const text = "secret garden / secret / safe";
  const buffer = createFilteredTextBuffer(filter); let output = "";
  for (const char of text.split("")) output += buffer.push(char);
  output += buffer.push("", true);
  assert.equal(output, filter.mask(text).text);
  const aborted = createFilteredTextBuffer(filter);
  assert.equal(aborted.push("secr"), ""); aborted.discard();
  assert.equal(aborted.push("", true), "");
});
