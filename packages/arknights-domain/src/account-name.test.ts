import assert from "node:assert/strict";
import test from "node:test";

import { validateWebsiteAccountName } from "./account-name.ts";

test("website account names accept the documented characters and trim outer spaces", () => {
  assert.deepEqual(validateWebsiteAccountName("  夜游川_01-A  "), { name: "夜游川_01-A", error: null });
  assert.deepEqual(validateWebsiteAccountName("Doctor Rhodes"), { name: "Doctor Rhodes", error: null });
});

test("website account names enforce length, character, and spacing limits", () => {
  assert.match(validateWebsiteAccountName("A").error ?? "", /2–20/);
  assert.match(validateWebsiteAccountName("A".repeat(21)).error ?? "", /2–20/);
  assert.match(validateWebsiteAccountName("博士😀").error ?? "", /只能使用/);
  assert.match(validateWebsiteAccountName("__").error ?? "", /至少包含/);
  assert.match(validateWebsiteAccountName("Doctor  Rhodes").error ?? "", /连续空格/);
});
