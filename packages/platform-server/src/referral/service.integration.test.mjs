import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import process from "node:process";
import { URL } from "node:url";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);
const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("An explicitly isolated *_test database is required.");
process.env.DATABASE_URL = url;
process.env.SKLAND_SESSION_SECRET = "referral-integration-only-secret-at-least-32-bytes";
const { getDatabasePool } = await import("../db/index.ts");
const referral = await import("./service.ts");
const { bindSklandAccount } = await import("../skland/bindings.ts");
const { sklandBindingKey } = await import("../skland/session.ts");
const { PRIVACY_VERSION, TERMS_VERSION } = await import("../../../platform/legal-policy.ts");
const consent = { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: Date.now() };

test("referral campaign preserves attribution, identity and exactly-once capped credits", async t => {
  const pool = getDatabasePool();
  const users = [];
  const keys = [];
  let actor;
  async function user(code = null) {
    const id = `referral-test-${randomUUID()}`;
    users.push(id);
    await pool.query('INSERT INTO public."user" (id,name,email,email_verified,signup_referral_code) VALUES ($1,$1,$2,true,$3)', [id, `${id}@example.test`, code]);
    return id;
  }
  async function toggle(enabled) {
    const state = await referral.getReferralCampaign();
    return referral.setReferralCampaign(actor, { enabled, reason: "integration test", idempotencyKey: randomUUID(), expectedUpdatedAt: state.updatedAt });
  }
  async function bind(id, key = `referral-key-${randomUUID()}`, fail = false) {
    if (!keys.includes(key)) keys.push(key);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO public.skland_binding (binding_key,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [key, id]);
      await referral.qualifyReferral(id, key, client);
      if (fail) throw new Error("simulated failure before commit");
      await client.query("COMMIT");
      return key;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async function balance(id) {
    const { rows } = await pool.query("SELECT paid_points,held_paid_points,monthly_points FROM app.billing_wallet WHERE user_id=$1", [id]);
    return Number(rows[0]?.paid_points ?? 0);
  }
  async function invite(code) {
    const admitted = await referral.prepareReferralSignup(code);
    assert.equal(admitted, code);
    const id = await user(admitted);
    await referral.captureReferralForNewUser(id, admitted);
    return id;
  }
  try {
    actor = await user();
    const inviter = await user();
    const code = (await referral.getReferralSummary(inviter)).account.code;
    assert.match(code, /^[A-F\d]{24}$/);

    await t.test("default-off, private summaries and old-account exclusion", async () => {
      assert.equal((await referral.getReferralSummary()).enabled, false);
      assert.equal((await referral.getReferralSummary()).account, null);
      assert.equal(await referral.prepareReferralSignup(code), null);
      await toggle(true);
      assert.equal(await referral.prepareReferralSignup(code.toLowerCase()), code);
      assert.equal(await referral.prepareReferralSignup("bad-code"), null);
      await referral.captureReferralForNewUser(inviter, code);
      assert.equal((await referral.getReferralSummary(inviter)).account.registeredCount, 0);
    });

    await t.test("signup marker survives a failed callback and campaign close", async () => {
      const marker = await referral.prepareReferralSignup(code);
      const recipient = await user(marker);
      await toggle(false);
      assert.equal(await referral.prepareReferralSignup(code), null);
      await bind(recipient);
      const closed = (await referral.getReferralSummary(inviter)).account;
      assert.equal(closed.registeredCount, 1);
      assert.equal(closed.qualifiedCount, 1);
      assert.equal(closed.rewardedCount, 0);
      await toggle(true);
      const open = (await referral.getReferralSummary(inviter)).account;
      assert.equal(open.earnedPoints, 10);
      assert.equal(await balance(inviter), 10);
      assert.equal(open.referrals[0].status, "rewarded");
      assert.deepEqual(Object.keys(open.referrals[0]).sort(), ["createdAt", "id", "points", "qualifiedAt", "rewardedAt", "status"].sort());
    });

    await t.test("duplicate authentication and multiple distinct referrals serialize at the five-reward limit", async () => {
      const recipients = await Promise.all(Array.from({ length: 8 }, () => invite(code)));
      const bindingKeys = await Promise.all(recipients.map(id => bind(id)));
      await Promise.all(recipients.flatMap((id, index) => Array.from({ length: 3 }, () => referral.qualifyReferral(id, bindingKeys[index]))));
      const account = (await referral.getReferralSummary(inviter)).account;
      assert.equal(account.registeredCount, 9);
      assert.equal(account.qualifiedCount, 9);
      assert.equal(account.rewardedCount, 5);
      assert.equal(account.earnedPoints, 50);
      assert.equal(account.remainingRewards, 0);
      assert.equal(await balance(inviter), 50);
      const { rows: [ledger] } = await pool.query("SELECT count(*)::int AS count,sum(points_delta)::int AS points FROM app.billing_ledger WHERE user_id=$1 AND kind='referral_reward'", [inviter]);
      assert.deepEqual(ledger, { count: 5, points: 50 });
      // Spending points and toggling the campaign must not refresh the allowance.
      await pool.query("UPDATE app.billing_wallet SET paid_points=0 WHERE user_id=$1", [inviter]);
      await toggle(false); await toggle(true);
      await bind(await invite(code));
      assert.equal(await balance(inviter), 0);
      assert.equal((await referral.getReferralSummary(inviter)).account.earnedPoints, 50);
    });

    await t.test("a historical identity cannot qualify after unbinding or deleting its first website account", async () => {
      const otherInviter = await user();
      const otherCode = (await referral.getReferralSummary(otherInviter)).account.code;
      const original = await user();
      const identity = await bind(original);
      await pool.query('DELETE FROM public."user" WHERE id=$1', [original]);
      const recipient = await invite(otherCode);
      await bind(recipient, identity);
      const summary = (await referral.getReferralSummary(otherInviter)).account;
      assert.equal(summary.referrals[0].status, "rejected");
      assert.equal(summary.earnedPoints, 0);
      assert.equal((await pool.query("SELECT first_user_id FROM app.referral_identity WHERE binding_key=$1", [identity])).rows[0].first_user_id, original);
      // The inviter's own previously used identity is equally ineligible.
      const selfIdentity = await bind(otherInviter);
      await pool.query("DELETE FROM public.skland_binding WHERE binding_key=$1", [selfIdentity]);
      await bind(await invite(otherCode), selfIdentity);
      assert.equal((await referral.getReferralSummary(otherInviter)).account.earnedPoints, 0);
    });

    await t.test("production binding locks and both users' summary recovery coexist under mixed concurrency", async () => {
      const owner = await user();
      const ownerCode = (await referral.getReferralSummary(owner)).account.code;
      const recipients = await Promise.all(Array.from({ length: 6 }, () => invite(ownerCode)));
      const sklandUsers = recipients.map(() => `referral-skland-${randomUUID()}`);
      keys.push(...sklandUsers.map(id => sklandBindingKey(id)));
      // Use the real binding entry point, including its SELECT FOR UPDATE,
      // while closed so every row is qualified before recovery competes.
      await toggle(false);
      await Promise.all(recipients.map((id, index) => bindSklandAccount(id, sklandUsers[index], consent)));
      assert.equal(await balance(owner), 0);
      await toggle(true);
      const results = await Promise.allSettled(recipients.flatMap((id, index) => [
        bindSklandAccount(id, sklandUsers[index], consent),
        bindSklandAccount(id, sklandUsers[index], consent),
        referral.getReferralSummary(id),
        referral.getReferralSummary(owner),
      ]));
      for (const result of results) assert.equal(result.status, "fulfilled", result.status === "rejected" ? String(result.reason) : "");
      const account = (await referral.getReferralSummary(owner)).account;
      assert.equal(account.registeredCount, 6);
      assert.equal(account.qualifiedCount, 6);
      assert.equal(account.rewardedCount, 5);
      assert.equal(account.earnedPoints, 50);
      assert.equal(account.referrals.filter(row => row.status === "capped").length, 1);
      assert.equal(await balance(owner), 50);
      const { rows: [ledger] } = await pool.query("SELECT count(*)::int AS count,sum(points_delta)::int AS points FROM app.billing_ledger WHERE user_id=$1 AND kind='referral_reward'", [owner]);
      assert.deepEqual(ledger, { count: 5, points: 50 });
      const { rows: identities } = await pool.query("SELECT first_user_id FROM app.referral_identity WHERE binding_key=ANY($1::text[])", [sklandUsers.map(id => sklandBindingKey(id))]);
      assert.deepEqual(identities.map(row => row.first_user_id).sort(), [...recipients].sort());
    });

    await t.test("one immutable registration and one reward survive retry, multiple bindings, and invitee deletion", async () => {
      const owner = await user();
      const ownerCode = (await referral.getReferralSummary(owner)).account.code;
      const recipient = await invite(ownerCode);
      await referral.captureReferralForNewUser(recipient, code);
      const firstKey = await bind(recipient);
      await bind(recipient);
      await pool.query('DELETE FROM public."user" WHERE id=$1', [recipient]);
      assert.equal((await referral.getReferralSummary(owner)).account.earnedPoints, 10);
      const next = await invite(ownerCode);
      await bind(next, firstKey);
      assert.equal((await referral.getReferralSummary(owner)).account.earnedPoints, 10);
      assert.equal(await balance(owner), 10);
    });

    await t.test("binding, identity, wallet and ledger roll back together in the caller transaction", async () => {
      const owner = await user();
      const ownerCode = (await referral.getReferralSummary(owner)).account.code;
      const recipient = await invite(ownerCode);
      const key = `referral-key-${randomUUID()}`;
      await assert.rejects(bind(recipient, key, true), /simulated failure/);
      assert.equal(await balance(owner), 0);
      assert.equal((await pool.query("SELECT status FROM app.referral_registration WHERE invitee_user_id=$1", [recipient])).rows[0].status, "pending");
      assert.equal((await pool.query("SELECT binding_key FROM app.referral_identity WHERE binding_key=$1", [key])).rowCount, 0);
      assert.equal((await pool.query("SELECT binding_key FROM public.skland_binding WHERE binding_key=$1", [key])).rowCount, 0);
      await bind(recipient, key);
      assert.equal(await balance(owner), 10);
    });

    await t.test("forged binding evidence and malformed admin updates cannot issue points", async () => {
      const owner = await user();
      const ownerCode = (await referral.getReferralSummary(owner)).account.code;
      const recipient = await invite(ownerCode);
      await referral.qualifyReferral(recipient, "missing-key");
      const key = await bind(await user());
      await referral.qualifyReferral(recipient, key);
      assert.equal(await balance(owner), 0);
      await assert.rejects(referral.setReferralCampaign(actor, { enabled: "true" }), referral.ReferralError);
    });

    await t.test("database account verification and bans override cached sessions and defer rewards", async () => {
      const owner = await user();
      const ownerCode = (await referral.getReferralSummary(owner)).account.code;
      const recipient = await invite(ownerCode);
      await pool.query('UPDATE public."user" SET email_verified=false WHERE id=$1', [recipient]);
      const key = await bind(recipient);
      assert.equal(await balance(owner), 0);
      await pool.query('UPDATE public."user" SET email_verified=true,banned=true WHERE id=$1', [recipient]);
      await referral.qualifyReferral(recipient, key);
      assert.equal(await balance(owner), 0);
      await assert.rejects(referral.getReferralSummary(recipient), referral.ReferralError);
      await pool.query('UPDATE public."user" SET banned=false WHERE id=$1', [recipient]);
      await pool.query('UPDATE public."user" SET banned=true WHERE id=$1', [owner]);
      await referral.qualifyReferral(recipient, key);
      assert.equal(await balance(owner), 0);
      assert.equal(await referral.prepareReferralSignup(ownerCode), null);
      await assert.rejects(referral.getReferralSummary(owner), referral.ReferralError);
      await pool.query('UPDATE public."user" SET banned=false WHERE id=$1', [owner]);
      assert.equal((await referral.getReferralSummary(owner)).account.earnedPoints, 10);
      const missing = await user();
      await pool.query('DELETE FROM public."user" WHERE id=$1', [missing]);
      await assert.rejects(referral.getReferralSummary(missing), referral.ReferralError);
    });

    await t.test("legacy bindings are retained only after fresh authorization, including while the campaign is closed", async () => {
      const owner = await user();
      const ownerCode = (await referral.getReferralSummary(owner)).account.code;
      const oldAccount = await user();
      const key = `referral-key-${randomUUID()}`; keys.push(key);
      await pool.query("INSERT INTO public.skland_binding (binding_key,user_id) VALUES ($1,$2)", [key, oldAccount]);
      const migration = await readFile(new URL("../../../../drizzle/0030_agent_referral.sql", import.meta.url), "utf8");
      const backfill = migration.split("--> statement-breakpoint").find(sql => sql.includes('INSERT INTO "app"."referral_identity"'));
      assert.equal(backfill, undefined);
      await toggle(false);
      await referral.getReferralSummary(oldAccount);
      assert.equal((await pool.query("SELECT * FROM app.referral_identity WHERE binding_key=$1", [key])).rowCount, 0);
      await toggle(true);
      await referral.getReferralSummary(oldAccount);
      assert.equal((await pool.query("SELECT * FROM app.referral_identity WHERE binding_key=$1", [key])).rowCount, 0);
      await toggle(false);
      await bind(oldAccount, key);
      assert.equal((await pool.query("SELECT first_user_id FROM app.referral_identity WHERE binding_key=$1", [key])).rows[0].first_user_id, oldAccount);
      await toggle(true);
      await pool.query('DELETE FROM public."user" WHERE id=$1', [oldAccount]);
      await bind(await invite(ownerCode), key);
      assert.equal((await referral.getReferralSummary(owner)).account.referrals[0].status, "rejected");
      assert.equal(await balance(owner), 0);
    });

    await t.test("admin retries are idempotent and stale concurrent writes are rejected and audited", async () => {
      const before = await referral.getReferralCampaign();
      const change = { enabled: false, reason: "test close", idempotencyKey: randomUUID(), expectedUpdatedAt: before.updatedAt };
      await Promise.all([referral.setReferralCampaign(actor, change), referral.setReferralCampaign(actor, change)]);
      await assert.rejects(referral.setReferralCampaign(actor, { ...change, enabled: true }), referral.ReferralError);
      const current = await referral.getReferralCampaign();
      assert.match(current.updatedAt, /\.\d{6}Z$/);
      assert.notEqual(current.updatedAt, before.updatedAt);
      await assert.rejects(referral.setReferralCampaign(actor, { ...change, idempotencyKey: randomUUID() }), referral.ReferralError);
      const results = await Promise.allSettled([true, false].map(enabled => referral.setReferralCampaign(actor, {
        enabled, reason: "concurrent edit", idempotencyKey: randomUUID(), expectedUpdatedAt: current.updatedAt,
      })));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM app.billing_admin_audit WHERE idempotency_key=$1", [`referral:campaign:${change.idempotencyKey}`])).rows[0].count, 1);
    });
  } finally {
    await pool.query("UPDATE app.site_setting SET value=$1 WHERE key='agent_referral'", [JSON.stringify({ enabled: false })]);
    await pool.query("DELETE FROM app.referral_registration WHERE inviter_user_id=ANY($1::text[]) OR invitee_user_id=ANY($1::text[])", [users]);
    await pool.query("DELETE FROM app.referral_identity WHERE binding_key=ANY($1::text[])", [keys]);
    await pool.query("DELETE FROM app.billing_admin_audit WHERE actor_id=ANY($1::text[])", [users]);
    await pool.query('DELETE FROM public."user" WHERE id=ANY($1::text[])', [users]);
    await pool.end();
  }
});
