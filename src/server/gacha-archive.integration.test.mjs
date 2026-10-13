import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import process from "node:process";
import { URL } from "node:url";
import { eq } from "drizzle-orm";
import { getDatabase, getDatabasePool } from "./db/index.ts";
import { user, gachaDraw, gachaArchive } from "./db/schema.ts";

const url = new URL(process.env.AUTH_INTEGRATION_DATABASE_URL ?? "http://invalid");
if (!/^\/riic_gacha_test_[a-f0-9]{32}$/.test(url.pathname) || process.env.DATABASE_URL !== url.toString()) throw new Error("Use scripts/test-gacha-archive.mjs to create an isolated database.");
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : nextResolve(specifier, context);
} });
const { saveGachaArchive, readGachaArchive, listGachaArchives, clearGachaArchive } = await import("./gacha-archive.ts");
test.after(async () => { await getDatabasePool().end(); hook.deregister(); });

test("PostgreSQL archive preserves ownership, concurrent deduplication, incremental history, and deletion semantics", async () => {
  const db = getDatabase();
  await db.insert(user).values(["owner-a", "owner-b"].map((id) => ({ id, name: id, email: `${id}@archive.test` })));
  const base = { id: "untrusted-id", category: "normal", poolId: "p1", poolName: "Pool", charId: "char_1", charName: "One", stars: 6, isNew: false, timestamp: 1791500000000, pos: 0 };
  const history = { uid: "10001", nickname: "One", records: [base], warnings: [], fetchedAt: new Date().toISOString() };
  const results = await Promise.allSettled([saveGachaArchive("owner-a", history, "browser"), saveGachaArchive("owner-b", history, "official")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const owner = results[0].status === "fulfilled" ? "owner-a" : "owner-b";
  const other = owner === "owner-a" ? "owner-b" : "owner-a";
  assert.equal(await readGachaArchive(other, "10001"), null);
  assert.deepEqual(await listGachaArchives(other), []);
  await assert.rejects(clearGachaArchive(other, "10001"));
  const corrected = { ...base, id: "official", charName: "Correct official name" };
  await Promise.all(Array.from({ length: 3 }, () => saveGachaArchive(owner, { ...history, records: [corrected, corrected] }, "official")));
  await saveGachaArchive(owner, { ...history, records: [{ ...base, charName: "Browser must not overwrite" }] }, "browser");
  let saved = await readGachaArchive(owner, "10001");
  assert.equal(saved.records.length, 1);
  assert.equal(saved.records[0].charName, corrected.charName);
  await saveGachaArchive(owner, { ...history, records: [{ ...base, id: "new", timestamp: base.timestamp + 1000 }], warnings: ["another category unavailable"] }, "official");
  saved = await readGachaArchive(owner, "10001");
  assert.equal(saved.records.length, 2);
  assert.deepEqual(saved.warnings, ["another category unavailable"]);
  // An empty / partial refresh never replaces the accumulated archive.
  await saveGachaArchive(owner, { ...history, records: [] }, "official");
  assert.equal((await readGachaArchive(owner, "10001")).records.length, 2);
  await saveGachaArchive(owner, { ...history, uid: "10002" }, "official");
  assert.equal((await listGachaArchives(owner)).length, 2);
  await clearGachaArchive(owner, "10001");
  assert.equal(await readGachaArchive(owner, "10001"), null);
  assert.equal((await readGachaArchive(owner, "10002")).records.length, 1);
  await assert.rejects(saveGachaArchive(other, history, "official"));
  assert.equal((await listGachaArchives(owner)).length, 2, "clearing records retains permanent binding");
  await db.delete(user).where(eq(user.id, owner));
  assert.equal((await db.select().from(gachaArchive)).length, 0);
  assert.equal((await db.select().from(gachaDraw)).length, 0, "website account deletion cascades to draws");
});
