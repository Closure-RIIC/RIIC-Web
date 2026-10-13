import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register, registerHooks } from "node:module";
import test from "node:test";
import process from "node:process";
import { URL, URLSearchParams } from "node:url";

register("../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });

const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("An explicitly isolated *_test database is required.");
process.env.DATABASE_URL = databaseUrl;
const { getDatabasePool } = await import("../db/index.ts");
const { issueAdminCdks, listAdminCdks, revokeAdminCdks } = await import("./admin-cdk.ts");
const { getWallet, redeemGiftCdk } = await import("./service.ts");
const { hashCdk, randomCdk } = await import("./cdk.ts");

test("PostgreSQL credit code lifecycle preserves exactly-once grants and revocation audit", async () => {
  const pool = getDatabasePool();
  const admin = `cdk-test-admin-${randomUUID()}`;
  const recipient = `cdk-test-user-${randomUUID()}`;
  const recipient2 = `cdk-test-user-${randomUUID()}`;
  try {
    for (const id of [admin, recipient, recipient2]) await pool.query('insert into public."user" (id,name,email,role) values ($1,$1,$2,$3)', [id, `${id}@example.test`, id === admin ? "admin" : "user"]);
    const batchId = randomUUID();
    const batch = await issueAdminCdks(admin, { batchId, count: 2, points: 30, batchLabel: "integration batch" });
    assert.equal((await getWallet(admin)).totalPoints, 0, "promotional issuance never debits the admin wallet");
    await assert.rejects(issueAdminCdks(admin, { batchId, count: 2, points: 30 }));
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => redeemGiftCdk(i % 2 ? recipient2 : recipient, batch.codes[0])));
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await getWallet(recipient)).totalPoints + (await getWallet(recipient2)).totalPoints, 30);
    assert.equal((await revokeAdminCdks(admin, { batchId, reason: "campaign ended" })).revoked, 1);
    assert.equal((await revokeAdminCdks(admin, { batchId, reason: "retry" })).revoked, 0);
    await assert.rejects(redeemGiftCdk(recipient, batch.codes[1]), /已作废/);
    const listing = await listAdminCdks(new URLSearchParams({ q: batchId }));
    assert.equal(listing.total, 2);
    assert.equal(listing.summary.redeemed, 1);
    assert.equal(listing.summary.outstandingPoints, 0);
    const revoked = listing.codes.find(code => code.availability === "revoked");
    assert.equal(revoked.revokedBy, admin);
    assert.equal(revoked.revokeReason, "campaign ended");
    assert.ok(revoked.revokedAt);
    assert.ok(listing.codes.every(code => !("codeHash" in code) && !("code" in code)));

    const future = await issueAdminCdks(admin, { batchId: randomUUID(), count: 1, points: 30, startsAt: "2098-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" });
    await assert.rejects(redeemGiftCdk(recipient, future.codes[0]), /尚未/);
    await pool.query('update app.billing_cdk set starts_at=null, expires_at=now()-interval \'1 second\' where batch_id=$1', [future.batchId]);
    await assert.rejects(redeemGiftCdk(recipient, future.codes[0]), /已过期/);
    assert.equal((await listAdminCdks(new URLSearchParams({ q: future.batchId, status: "expired" }))).total, 1);

    const legacyBatch = randomUUID();
    const legacyCode = randomCdk();
    await pool.query('insert into app.billing_cdk (id,code_hash,issuer_user_id,points) values ($1,$2,$3,30)', [`admin:${legacyBatch}:0`, hashCdk(legacyCode), admin]);
    assert.equal((await listAdminCdks(new URLSearchParams({ q: legacyBatch }))).codes[0].batchId, legacyBatch);
    assert.equal((await revokeAdminCdks(admin, { batchId: legacyBatch, reason: "legacy batch revoked" })).revoked, 1);
    await assert.rejects(redeemGiftCdk(recipient, legacyCode), /已作废/);
    const oldGift = randomCdk();
    await pool.query('insert into app.billing_cdk (id,code_hash,issuer_user_id,points) values ($1,$2,$3,50)', [randomUUID(), hashCdk(oldGift), admin]);
    assert.equal((await redeemGiftCdk(recipient, oldGift.toLowerCase())).points, 50, "legacy gift format still redeems");

    const before = Number((await pool.query('select count(*) from app.billing_cdk where issuer_user_id=$1', [admin])).rows[0].count);
    await assert.rejects(issueAdminCdks(admin, { batchId: randomUUID(), count: 2, points: 10, codes: ["ATOMIC-" + randomUUID(), batch.codes[0]] }));
    assert.equal(Number((await pool.query('select count(*) from app.billing_cdk where issuer_user_id=$1', [admin])).rows[0].count), before, "one duplicate rolls back the complete insertion");
    const paginated = await issueAdminCdks(admin, { batchId: randomUUID(), count: 30, points: 1 });
    const secondPage = await listAdminCdks(new URLSearchParams({ q: paginated.batchId, page: "2" }));
    assert.equal(secondPage.codes.length, 5);
    assert.equal(secondPage.pages, 2);
    assert.equal((await revokeAdminCdks(admin, { batchId: paginated.batchId, reason: "all pages" })).revoked, 30);

    for (let index = 0; index < 5; index++) {
      const race = await issueAdminCdks(admin, { batchId: randomUUID(), count: 1, points: 7 });
      const id = `admin:${race.batchId}:0`;
      await Promise.allSettled([redeemGiftCdk(recipient, race.codes[0]), revokeAdminCdks(admin, { id, reason: "race" })]);
      const state = (await pool.query('select status from app.billing_cdk where id=$1', [id])).rows[0].status;
      const ledger = (await pool.query('select count(*)::int as count, sum(points_delta)::int as points from app.billing_ledger where reference_id=$1', [id])).rows[0];
      assert.ok(["redeemed", "revoked"].includes(state));
      assert.equal(ledger.count, state === "redeemed" ? 1 : 0);
      if (state === "redeemed") assert.equal(ledger.points, 7);
    }
  } finally {
    await pool.query('delete from public."user" where id=any($1::text[])', [[admin, recipient, recipient2]]);
    await pool.end();
  }
});
