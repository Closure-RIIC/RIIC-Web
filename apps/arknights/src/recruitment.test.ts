import assert from "node:assert/strict";
import test from "node:test";
import { calculateRecruitment, RECRUITMENT_OPERATORS, recruitmentOwnership } from "./recruitment.ts";

test("enumerates all one-to-three tag combinations without duplicates", () => {
  const tags = [1, 9, 19, 20, 14];
  const results = calculateRecruitment(tags);
  assert.ok(results.length > 5 && results.length <= 25);
  assert.equal(new Set(results.map((row) => row.tags.join(","))).size, results.length);
  for (const row of results) {
    assert.ok(row.tags.length >= 1 && row.tags.length <= 3);
    assert.ok(row.operators.every((operator) => row.tags.every((id) => operator.tags.includes(id))));
    assert.equal(row.minimumRarity, Math.min(...row.operators.map((operator) => operator.rarity)));
  }
  assert.deepEqual(calculateRecruitment([1, 1]), calculateRecruitment([1]));
  assert.deepEqual(calculateRecruitment([]), []);
});

test("six stars require Top Operator; rare tag precedence is respected", () => {
  assert.ok(calculateRecruitment([19, 9]).every((row) => row.operators.every((operator) => operator.rarity < 6)));
  assert.ok(calculateRecruitment([11])[0].operators.every((operator) => operator.rarity === 6));
  assert.ok(calculateRecruitment([14])[0].operators.every((operator) => operator.rarity === 5));
  const both = calculateRecruitment([11, 14]).find((row) => row.tags.length === 2);
  assert.ok(both && both.operators.every((operator) => operator.rarity === 6));
});

test("duration boundaries exclude robots at four hours and two stars at 7:40", () => {
  assert.ok(calculateRecruitment([28], 230)[0].operators.every((operator) => operator.rarity === 1));
  assert.deepEqual(calculateRecruitment([28], 240), []);
  assert.ok(calculateRecruitment([17], 450)[0].operators.every((operator) => operator.rarity === 2));
  assert.deepEqual(calculateRecruitment([17], 460), []);
  assert.ok(calculateRecruitment([19], 230).every((row) => row.operators.every((operator) => operator.rarity <= 4)));
  assert.ok(calculateRecruitment([19], 240)[0].operators.some((operator) => operator.rarity === 5));
  assert.equal(calculateRecruitment([14], 230)[0].minimumRarity, 5);
});

test("Box distinguishes unknown, owned and missing, using ID or normalized name", () => {
  const operator = RECRUITMENT_OPERATORS[0];
  assert.equal(recruitmentOwnership(operator, null), "unknown");
  assert.equal(recruitmentOwnership(operator, []), "missing");
  assert.equal(recruitmentOwnership(operator, [{ ...operator, own: false }]), "missing");
  assert.equal(recruitmentOwnership(operator, [{ id: "legacy-id", name: operator.name, own: true }]), "owned");
  assert.equal(recruitmentOwnership(operator, [{ id: operator.id, name: "", own: true }]), "owned");
  const original = calculateRecruitment([25]);
  const owned = original[0].operators[0];
  const linked = calculateRecruitment([25], 540, [{ ...owned, own: true }]);
  assert.equal(original[0].missingCount, null);
  assert.equal(linked[0].missingCount, original[0].operators.length - 1);
  assert.equal(linked[0].operators.length, original[0].operators.length);
  assert.equal(linked[0].minimumRarity, original[0].minimumRarity);
});

test("rejects invalid input and sorts by minimum rarity", () => {
  assert.throws(() => calculateRecruitment([1, 2, 3, 4, 5, 6]));
  assert.throws(() => calculateRecruitment([999]));
  assert.throws(() => calculateRecruitment([19], 235));
  const results = calculateRecruitment([19, 25, 14]);
  assert.ok(results.every((row, index) => !index || row.minimumRarity <= results[index - 1].minimumRarity));
});
