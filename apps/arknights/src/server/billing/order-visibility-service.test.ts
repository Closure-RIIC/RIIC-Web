import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });

test("database predicates filter before limiting and hide only the owner's pending orders", async t => {
  const dialect = new PgDialect();
  let query: { sql: string; params: unknown[] } | undefined;
  const record = (condition: Parameters<typeof dialect.sqlToQuery>[0]) => { query = dialect.sqlToQuery(condition); };
  await t.mock.module(new URL("../db/index.ts", import.meta.url), { namedExports: { getDatabase: () => ({
    select: () => ({ from: () => ({ where: (condition: Parameters<typeof record>[0]) => {
      record(condition); return { orderBy: () => ({ limit: async () => [] }) };
    } }) }),
    update: () => ({ set: (values: { hiddenAt?: Date; status?: string }) => {
      assert.ok(values.hiddenAt instanceof Date);
      assert.equal(values.status, undefined);
      return { where: (condition: Parameters<typeof record>[0]) => { record(condition); return { returning: async () => [{ id: "order" }] }; } };
    } }),
  }) } });
  const { listOrders, hidePendingOrder, hideAllPendingOrders } = await import("./service.ts");
  await listOrders("owner");
  assert.match(query!.sql, /"hidden_at" is null/);
  assert.match(query!.sql, /"created_at" >/);
  assert.match(query!.sql, /"status" <>/);
  assert.deepEqual(query!.params.slice(0, 2), ["owner", "pending"]);
  assert.equal(await hidePendingOrder("owner", "order"), true);
  assert.deepEqual(query!.params, ["owner", "order", "pending"]);
  assert.equal(await hideAllPendingOrders("owner"), 1);
  assert.deepEqual(query!.params, ["owner", "pending"]);
  assert.match(query!.sql, /"hidden_at" is null/);
});
