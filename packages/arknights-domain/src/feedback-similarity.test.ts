import assert from "node:assert/strict";
import test from "node:test";
import { feedbackOperators, feedbackMatch, type SimilarityInput } from "./feedback-similarity.ts";
test("operator extraction uses room and description, normalizes names and avoids short-name overlap", () => {
  assert.deepEqual(feedbackOperators({ operators: ["Amiya"] }, "肥鸭与玛恩纳配置异常"), ["玛恩纳", "菲亚梅塔", "阿米娅"].sort());
  const names = feedbackOperators(null, "假日威龙陈");
  assert.ok(names.includes("假日威龙陈"));
  assert.ok(!names.includes("陈"));
});
test("matching never uses an unrelated box roster and ranks exact diagnosis first", () => {
  const base: SimilarityInput = { id: "a", diagnosticId: "one", facility: "manufacture", operators: ["阿米娅"], inputFingerprint: null, errorCode: null };
  assert.equal(feedbackMatch(base, { ...base, id: "b", diagnosticId: "two", operators: ["能天使"] }), null);
  assert.equal(feedbackMatch(base, { ...base, id: "b" })?.reason, "same_diagnostic");
  assert.equal(feedbackMatch(base, { ...base, id: "b", diagnosticId: "two" })?.reason, "shared_room_operators");
  assert.equal(feedbackMatch(base, { ...base, id: "b", diagnosticId: "two", facility: "trading" }), null);
});
