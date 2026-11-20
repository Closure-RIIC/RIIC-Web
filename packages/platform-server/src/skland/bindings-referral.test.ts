import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../platform/legal-policy.ts";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("Skland binding and referral qualification share the commit boundary and retry safely", async context => {
  const consent = { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: Date.now() };
  const calls: string[] = [];
  let owner = "website-user";
  let qualificationFails = false;
  const client = {
    async query(statement: string, parameters?: unknown[]) {
      const action = statement.trim().split(/\s/)[0];
      calls.push(action);
      if (action === "INSERT") assert.deepEqual(parameters, ["private-binding-key", "website-user"]);
      return { rows: action === "SELECT" ? [{ user_id: owner }] : [] };
    },
    release() { calls.push("release"); },
  };
  await context.mock.module(new URL("../db/index.ts", import.meta.url), {
    namedExports: {
      getDatabasePool: () => ({ connect: async () => client }),
      getDatabase: () => ({ select: () => ({ from: () => ({ where: async () => {
        calls.push("summary");
        return [{ lastAuthorizedAt: new Date() }];
      } }) }) }),
    },
  });
  await context.mock.module(new URL("./session.ts", import.meta.url), {
    namedExports: { sklandBindingKey: (id: string) => { assert.equal(id, "upstream-user"); return "private-binding-key"; } },
  });
  await context.mock.module(new URL("../referral/service.ts", import.meta.url), {
    namedExports: { qualifyReferral: async (userId: string, bindingKey: string, transaction: unknown) => {
      calls.push("qualify");
      assert.equal(userId, "website-user");
      assert.equal(bindingKey, "private-binding-key");
      assert.equal(transaction, client);
      if (qualificationFails) throw new Error("reward unavailable");
    } },
  });
  const { bindSklandAccount, SklandBindingConflictError } = await import("./bindings.ts");

  await assert.rejects(bindSklandAccount("website-user", "upstream-user", { ...consent, privacyVersion: "legacy" as typeof PRIVACY_VERSION }), { code: "AIC-AUTH-2005" });
  assert.deepEqual(calls, [], "obsolete consent must not begin a binding or retain identity");

  const first = await bindSklandAccount("website-user", "upstream-user", consent);
  assert.equal(first.totalCount, 1);
  assert.deepEqual(calls, ["BEGIN", "INSERT", "SELECT", "UPDATE", "qualify", "COMMIT", "release", "summary"]);
  calls.length = 0;
  await bindSklandAccount("website-user", "upstream-user", consent);
  assert.deepEqual(calls, ["BEGIN", "INSERT", "SELECT", "UPDATE", "qualify", "COMMIT", "release", "summary"]);

  calls.length = 0;
  owner = "other-user";
  await assert.rejects(bindSklandAccount("website-user", "upstream-user", consent), SklandBindingConflictError);
  assert.deepEqual(calls, ["BEGIN", "INSERT", "SELECT", "ROLLBACK", "release"]);

  calls.length = 0;
  owner = "website-user";
  qualificationFails = true;
  await assert.rejects(bindSklandAccount("website-user", "upstream-user", consent), /reward unavailable/);
  assert.deepEqual(calls, ["BEGIN", "INSERT", "SELECT", "UPDATE", "qualify", "ROLLBACK", "release"]);
});
