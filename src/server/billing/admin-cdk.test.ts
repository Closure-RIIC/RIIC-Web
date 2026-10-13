import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import { hashCdk } from "./cdk.ts";

register("../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });

test("admin issuance writes one atomic batch of hashes with stable retry keys and no wallet debit", async (t) => {
  type Row = { id: string; issuerUserId: string; codeHash: string; points: number };
  const inserts: Row[][] = [];
  let failure: unknown;
  await t.mock.module(new URL("../db/index.ts", import.meta.url), { namedExports: { getDatabase: () => ({
    insert: () => ({ values: async (rows: Row[]) => { if (failure) throw failure; inserts.push(rows); } }),
  }) } });
  const { issueAdminCdks } = await import("./admin-cdk.ts");
  const input = { batchId: "ccdc31bf-3dc0-4d65-9fb9-6b55eabf5678", count: 20, points: 30 };
  const result = await issueAdminCdks("admin-1", input);
  assert.equal(inserts.length, 1);
  assert.equal(result.codes.length, 20);
  assert.equal(new Set(result.codes).size, 20);
  assert.equal(inserts[0].reduce((sum, row) => sum + row.points, 0), 600);
  for (const [index, row] of inserts[0].entries()) {
    assert.deepEqual(row, { id: `admin:${input.batchId}:${index}`, issuerUserId: "admin-1", codeHash: hashCdk(result.codes[index]), points: 30, batchId: input.batchId });
    assert.ok(!JSON.stringify(row).includes(result.codes[index]));
  }
  await assert.rejects(issueAdminCdks("admin-1", { ...input, points: -30 }));
  assert.equal(inserts.length, 1, "invalid requests do not reach the database");
  failure = new Error("query failed", { cause: { code: "23505", detail: "private database details" } });
  await assert.rejects(issueAdminCdks("admin-1", input), error => error instanceof Error && error.message.includes("此批次已生成") && !error.message.includes("private"));
  failure = new Error("database unavailable");
  await assert.rejects(issueAdminCdks("admin-1", input), /database unavailable/);
  failure = null;
  const custom = await issueAdminCdks("admin-1", { ...input, count: 1, codes: [" custom-30 "] });
  assert.deepEqual(custom.codes, ["CUSTOM-30"]);
  assert.equal(inserts[1][0].id, inserts[0][0].id, "retry key remains fixed regardless of new random codes or edited input");
});
