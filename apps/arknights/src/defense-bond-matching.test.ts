import test from "node:test";
import assert from "node:assert/strict";
import {
  bondOverlap,
  bondCompatibility,
  matchesRequiredBonds,
} from "./defense-bond-matching.ts";
import {
  parseBondMatchPreferences,
  DEFAULT_BOND_MATCH_PREFERENCES,
} from "./defense-team-validation.ts";

test("core overlap carries more weight; empty profiles remain unknown", () => {
  assert.equal(bondOverlap(["yan", "harmony"], ["yan", "swift"]), 0.5);
  assert.equal(bondOverlap(["yan"], ["yan"]), 1);
  assert.equal(bondOverlap(["yan"], ["sargon"]), 0);
  assert.equal(bondOverlap([], []), null);
  const good = bondCompatibility(["yan"], [{ favoriteFactions: ["sargon"] }]);
  const duplicate = bondCompatibility(["yan"], [{ favoriteFactions: ["yan"] }]);
  const unknown = bondCompatibility(["yan"], [{ favoriteFactions: [] }]);
  assert.equal(good.score, 100);
  assert.equal(duplicate.score, 0);
  assert.equal(unknown.score, null);
  assert.ok(
    good.penalty < unknown.penalty && unknown.penalty < duplicate.penalty,
  );
  assert.equal(
    bondCompatibility([], [{ favoriteFactions: ["yan"] }]).score,
    null,
  );
  assert.deepEqual(good.complementary, ["sargon"]);
  assert.deepEqual(duplicate.shared, ["yan"]);
  assert.equal(
    bondCompatibility(
      ["yan"],
      [{ favoriteFactions: ["sargon"] }, { favoriteFactions: [] }],
    ).score,
    67,
  );
  const repeated = bondCompatibility(
    ["yan"],
    [{ favoriteFactions: ["sargon"] }, { favoriteFactions: ["sargon"] }],
  );
  const diverse = bondCompatibility(
    ["yan"],
    [{ favoriteFactions: ["sargon"] }, { favoriteFactions: ["laterano"] }],
  );
  assert.ok(
    repeated.penalty > diverse.penalty,
    "Existing teammates' overlap matters too",
  );
  assert.deepEqual(repeated.teamRepeat, ["sargon"]);
});

test("required bonds use OR within each group and AND across groups", () => {
  const prefs = {
    ...DEFAULT_BOND_MATCH_PREFERENCES,
    requiredCoreBonds: ["yan", "sargon"] as const,
    requiredAddonBonds: ["harmony"] as const,
  };
  const normalized = {
    ...prefs,
    requiredCoreBonds: [...prefs.requiredCoreBonds],
    requiredAddonBonds: [...prefs.requiredAddonBonds],
  };
  assert.equal(
    matchesRequiredBonds(
      [{ favoriteFactions: ["yan", "harmony"] }],
      normalized,
    ),
    true,
  );
  assert.equal(
    matchesRequiredBonds(
      [{ favoriteFactions: ["sargon"] }, { favoriteFactions: ["harmony"] }],
      normalized,
    ),
    true,
  );
  assert.equal(
    matchesRequiredBonds([{ favoriteFactions: ["yan"] }], normalized),
    false,
  );
  assert.equal(
    matchesRequiredBonds(
      [{ favoriteFactions: ["laterano", "harmony"] }],
      normalized,
    ),
    false,
  );
  assert.equal(
    matchesRequiredBonds(
      [{ favoriteFactions: [] }],
      DEFAULT_BOND_MATCH_PREFERENCES,
    ),
    true,
  );
});

test("match preference inputs validate group boundaries and do not coerce booleans", () => {
  assert.deepEqual(
    parseBondMatchPreferences({}),
    DEFAULT_BOND_MATCH_PREFERENCES,
  );
  for (const bad of [
    null,
    [],
    { useProfileBonds: "false" },
    { avoidBondOverlap: 1 },
    { preferredBonds: ["unknown"] },
    { preferredBonds: ["yan", "yan"] },
    { requiredCoreBonds: ["harmony"] },
    { requiredAddonBonds: ["yan"] },
  ])
    assert.equal(parseBondMatchPreferences(bad), null);
  assert.deepEqual(
    parseBondMatchPreferences({
      useProfileBonds: false,
      preferredBonds: ["technique", "yan"],
      requiredCoreBonds: ["sargon"],
      requiredAddonBonds: ["harmony"],
      avoidBondOverlap: false,
    }),
    {
      useProfileBonds: false,
      preferredBonds: ["yan", "technique"],
      requiredCoreBonds: ["sargon"],
      requiredAddonBonds: ["harmony"],
      avoidBondOverlap: false,
    },
  );
});
