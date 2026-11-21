import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";
import { runWithEndpointContext, runWithTransaction } from "@better-auth/core/context";
import { parseUserOutput } from "better-auth/db";

/* global Headers, Request */

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);
const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL?.trim();
if (!databaseUrl || !decodeURIComponent(new URL(databaseUrl).pathname).endsWith("_test")) {
  throw new Error("An explicitly isolated *_test database is required.");
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  APP_DEPLOYMENT_ENV: "local",
  BETTER_AUTH_URL: "https://referral.integration.invalid",
  BETTER_AUTH_SECRET: "referral-auth-integration-only-secret-at-least-32-bytes",
  SKLAND_SESSION_SECRET: "referral-skland-integration-only-secret-at-least-32-bytes",
  PLATFORM_PUBLIC_ORIGINS: "",
  AUTH_COOKIE_DOMAIN: "",
  BETTER_AUTH_ADMIN_USER_IDS: "",
});
const { getAuth } = await import("./index.ts");
const { getDatabasePool } = await import("../db/index.ts");
const { bindSklandAccount } = await import("../skland/bindings.ts");
const { sklandBindingKey } = await import("../skland/session.ts");
const { PRIVACY_VERSION, TERMS_VERSION } = await import("../../../platform/legal-policy.ts");
const consent = { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: Date.now() };
const referral = await import("../referral/service.ts");

test("production Better Auth and Drizzle persist private signup attribution without credentials or external calls", async t => {
  const pool = getDatabasePool();
  const fixture = `referral-auth-test-${randomUUID()}`;
  const inviterId = `${fixture}-owner`;
  const inviteeEmail = `${fixture}-new@example.invalid`;
  const upstreamUserId = `${fixture}-skland`;
  const bindingKey = sklandBindingKey(upstreamUserId);
  const users = [inviterId];
  let previousCampaign;
  let databaseVerified = false;
  try {
    const { rows: [database] } = await pool.query("SELECT current_database() AS name");
    assert.equal(database.name, decodeURIComponent(new URL(databaseUrl).pathname).slice(1));
    assert.match(database.name, /_test$/);
    databaseVerified = true;
    const { rows: [previous] } = await pool.query("SELECT value,updated_at::text AS updated_at FROM app.site_setting WHERE key='agent_referral'");
    assert.ok(previous, "Apply referral migration before this integration test");
    previousCampaign = previous;
    await pool.query('INSERT INTO public."user" (id,name,email,email_verified) VALUES ($1,$2,$3,true)', [inviterId, "邀请人", `${fixture}-owner@example.invalid`]);
    const code = (await referral.getReferralSummary(inviterId)).account.code;
    const campaign = await referral.getReferralCampaign();
    await referral.setReferralCampaign(inviterId, {
      enabled: true, reason: "auth integration test", idempotencyKey: randomUUID(), expectedUpdatedAt: campaign.updatedAt,
    });

    const auth = getAuth();
    const authContext = await auth.$context;
    const passwordHash = t.mock.method(authContext.password, "hash", () => assert.fail("Password hashing must not run"));
    const sendEmail = t.mock.method(authContext.options.emailVerification, "sendVerificationEmail", () => assert.fail("Email sending must not run"));
    const networkFetch = t.mock.method(globalThis, "fetch", () => assert.fail("External HTTP calls must not run"));
    const headers = new Headers({ "x-riic-referral-code": code });
    const request = new Request("https://referral.integration.invalid/api/auth/sign-up/email", { method: "POST", headers });
    // Exercise the real account creation/adapter/hooks used by signup, without
    // invoking its password, credential-account or email-delivery endpoint steps.
    const created = await runWithEndpointContext({ path: "/sign-up/email", headers, request, context: authContext }, () =>
      runWithTransaction(authContext.adapter, () => authContext.internalAdapter.createUser({
        name: "  受邀用户  ", email: inviteeEmail, emailVerified: false,
      }, { method: "email-password" })),
    );
    users.push(created.id);
    assert.equal(created.signupReferralCode, code);
    assert.equal(created.name, "受邀用户");
    assert.equal(created.emailVerified, false);
    assert.equal(Object.hasOwn(parseUserOutput(auth.options, created), "signupReferralCode"), false);
    const { rows: [stored] } = await pool.query('SELECT signup_referral_code,email_verified FROM public."user" WHERE id=$1', [created.id]);
    assert.deepEqual(stored, { signup_referral_code: code, email_verified: false });
    const { rows: [registration] } = await pool.query("SELECT inviter_user_id,status FROM app.referral_registration WHERE invitee_user_id=$1", [created.id]);
    assert.deepEqual(registration, { inviter_user_id: inviterId, status: "pending" });

    await bindSklandAccount(created.id, upstreamUserId, consent);
    assert.equal((await referral.getReferralSummary(inviterId)).account.earnedPoints, 0);
    assert.equal((await pool.query("SELECT status FROM app.referral_registration WHERE invitee_user_id=$1", [created.id])).rows[0].status, "pending");
    assert.equal((await pool.query("SELECT id FROM app.billing_ledger WHERE user_id=$1 AND kind='referral_reward'", [inviterId])).rowCount, 0);

    // Simulate the existing email-verification result only; no password or OTP.
    await pool.query('UPDATE public."user" SET email_verified=true WHERE id=$1', [created.id]);
    await bindSklandAccount(created.id, upstreamUserId, consent);
    const account = (await referral.getReferralSummary(inviterId)).account;
    assert.equal(account.rewardedCount, 1);
    assert.equal(account.earnedPoints, 10);
    assert.equal(Number((await pool.query("SELECT paid_points FROM app.billing_wallet WHERE user_id=$1", [inviterId])).rows[0].paid_points), 10);
    assert.equal((await pool.query("SELECT id FROM app.billing_ledger WHERE user_id=$1 AND kind='referral_reward'", [inviterId])).rowCount, 1);
    assert.equal((await pool.query('SELECT id FROM public.account WHERE user_id=ANY($1::text[])', [users])).rowCount, 0);
    assert.equal(passwordHash.mock.callCount(), 0);
    assert.equal(sendEmail.mock.callCount(), 0);
    assert.equal(networkFetch.mock.callCount(), 0);
  } finally {
    try {
      if (databaseVerified && previousCampaign) {
        // Include a created user even if an assertion failed before its ID was kept.
        const created = await pool.query('SELECT id FROM public."user" WHERE email=$1', [inviteeEmail]);
        for (const row of created.rows) if (!users.includes(row.id)) users.push(row.id);
        await pool.query("DELETE FROM app.referral_registration WHERE inviter_user_id=ANY($1::text[]) OR invitee_user_id=ANY($1::text[])", [users]);
        await pool.query("DELETE FROM app.referral_identity WHERE binding_key=$1", [bindingKey]);
        await pool.query("DELETE FROM app.billing_admin_audit WHERE actor_id=ANY($1::text[])", [users]);
        await pool.query('DELETE FROM public."user" WHERE id=ANY($1::text[])', [users]);
        await pool.query("UPDATE app.site_setting SET value=$1,updated_at=$2::timestamptz WHERE key='agent_referral'", [previousCampaign.value, previousCampaign.updated_at]);
      }
    } finally { await pool.end(); }
  }
});
