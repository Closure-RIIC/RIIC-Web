import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNT_ORB_COLORS, accountOrbColor } from "./account-orb.ts";

test("assigns one stable Fluid Orb color from the account palette", () => {
  const first = accountOrbColor("signed-in-user");
  assert.ok(ACCOUNT_ORB_COLORS.includes(first));
  assert.equal(accountOrbColor("signed-in-user"), first);
});

test("distributes account identities across all four Fluid Orb colors", () => {
  const assigned = new Set(
    Array.from({ length: 64 }, (_, index) => accountOrbColor(`account-${index}`)),
  );
  assert.deepEqual(assigned, new Set(ACCOUNT_ORB_COLORS));
});
