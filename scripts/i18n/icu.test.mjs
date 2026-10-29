import assert from "node:assert/strict";
import test from "node:test";
import { icu } from "./icu.mjs";

test("ICU selectors scan arguments and rich tags, never branch prose", () => {
  const source = "{状态, select, ready {All done} other {<link>{count, plural, one {# item} other {# items}}</link>}}";
  assert.deepEqual(icu.find(source).map(item => item.name), ["状态", "<link>", "count"]);
  assert.deepEqual(icu.validate(source), []);
  assert.deepEqual(icu.find("'{literal}' {name}").map(item => item.name), ["name"]);
});

test("invalid syntax is reported even when parameter extraction cannot finish", () => {
  for (const source of ["{count, plural, one {item}}", "<link>broken", "{missing"]) {
    assert.equal(icu.validate(source).length, 1, source);
  }
});
