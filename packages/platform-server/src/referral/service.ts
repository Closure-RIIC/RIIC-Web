import "@tanstack/react-start/server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDatabasePool } from "../db/index.ts";

const CAMPAIGN_KEY = "agent_referral";
export const REFERRAL_REWARD_POINTS = 10;
export const REFERRAL_REWARD_LIMIT = 5;
export class ReferralError extends Error {}
type Campaign = { enabled: boolean; updatedAt: string | null };
type Registration = {
  id: string; inviter_user_id: string; invitee_user_id: string; binding_key: string | null;
  status: string; points: number; created_at: Date; qualified_at: Date | null; rewarded_at: Date | null;
};
type SummaryCounts = { registeredCount: number; qualifiedCount: number; rewardedCount: number; earnedPoints: number };

async function transaction<T>(fn: (client: PoolClient) => Promise<T>, existing?: PoolClient): Promise<T> {
  if (existing) return fn(existing);
  const client = await getDatabasePool().connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function campaign(client: PoolClient, lock: "share" | "update" = "share"): Promise<Campaign> {
  const result = await client.query(`SELECT value,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revision
    FROM app.site_setting WHERE key=$1 FOR ${lock === "share" ? "SHARE" : "UPDATE"}`, [CAMPAIGN_KEY]);
  const row = result.rows[0];
  // The migration installs this row; an absent row is fail-closed.
  return { enabled: row?.value?.enabled === true, updatedAt: row?.revision ?? null };
}

const COUNT_COLUMNS = `count(*)::int AS "registeredCount",count(*) FILTER (WHERE qualified_at IS NOT NULL)::int AS "qualifiedCount",
  count(*) FILTER (WHERE status='rewarded')::int AS "rewardedCount",coalesce(sum(points),0)::int AS "earnedPoints"`;
const ACTIVE_ACCOUNT = "NOT (coalesce(banned,false) AND (ban_expires IS NULL OR ban_expires>now()))";

/** Only called by the server's new-user hook, before the user row is inserted. */
export async function prepareReferralSignup(value: unknown): Promise<string | null> {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value.trim())) return null;
  const code = value.trim().toUpperCase();
  return transaction(async client => {
    if (!(await campaign(client)).enabled) return null;
    const result = await client.query(`SELECT c.code FROM app.referral_code c JOIN public."user" u ON u.id=c.user_id
      WHERE c.code=$1 AND NOT (coalesce(u.banned,false) AND (u.ban_expires IS NULL OR u.ban_expires>now()))`, [code]);
    return result.rows[0]?.code ?? null;
  });
}

async function capture(client: PoolClient, userId: string, suppliedCode?: string | null): Promise<void> {
  const { rows: [account] } = await client.query(`SELECT signup_referral_code,created_at FROM public."user" WHERE id=$1`, [userId]);
  const code = account?.signup_referral_code;
  // Never attach an invitation to an existing account via an API or a login.
  if (!code || (suppliedCode != null && suppliedCode !== code)) return;
  const { rows: [inviter] } = await client.query(`SELECT c.user_id FROM app.referral_code c
    JOIN public."user" u ON u.id=c.user_id WHERE c.code=$1 AND c.user_id<>$2 AND u.created_at<=$3 AND c.created_at<=$3`, [code, userId, account.created_at]);
  if (!inviter) return;
  // The signup marker records admission while enabled. Closing afterwards may
  // pause rewards but must not discard already admitted registrations.
  await client.query(`INSERT INTO app.referral_registration (id,inviter_user_id,invitee_user_id,created_at)
    VALUES ($1,$2,$3,$4) ON CONFLICT (invitee_user_id) DO NOTHING`, [randomUUID(), inviter.user_id, userId, account.created_at]);
}

export async function captureReferralForNewUser(userId: string, code?: string | null): Promise<void> {
  await transaction(client => capture(client, userId, code));
}

async function award(client: PoolClient, registration: Registration, enabled: boolean): Promise<void> {
  if (!enabled || registration.status !== "qualified") return;
  const invitee = await client.query(`SELECT id FROM public."user" WHERE id=$1 AND email_verified=true AND ${ACTIVE_ACCOUNT}`, [registration.invitee_user_id]);
  if (!invitee.rowCount) return;
  const { rows: [owner] } = await client.query(`SELECT id FROM public."user" WHERE id=$1
    AND NOT (coalesce(banned,false) AND (ban_expires IS NULL OR ban_expires>now())) FOR SHARE`, [registration.inviter_user_id]);
  if (!owner) return;
  await client.query("INSERT INTO app.billing_wallet (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [owner.id]);
  // This is the same wallet row lock used by purchases, CDKs and Agent charges.
  await client.query("SELECT user_id FROM app.billing_wallet WHERE user_id=$1 FOR UPDATE", [owner.id]);
  const { rows: [total] } = await client.query("SELECT count(*)::int AS count FROM app.referral_registration WHERE inviter_user_id=$1 AND status='rewarded'", [owner.id]);
  if (total.count >= REFERRAL_REWARD_LIMIT) {
    await client.query("UPDATE app.referral_registration SET status='capped',reason='inviter_limit' WHERE id=$1", [registration.id]);
    return;
  }
  const { rows: [updated] } = await client.query(`UPDATE app.billing_wallet SET paid_points=paid_points+$2,updated_at=now()
    WHERE user_id=$1 RETURNING paid_points,monthly_points`, [owner.id, REFERRAL_REWARD_POINTS]);
  await client.query(`INSERT INTO app.billing_ledger
    (id,user_id,kind,points_delta,paid_points_after,monthly_points_after,reference_type,reference_id,idempotency_key,metadata)
    VALUES ($1,$2,'referral_reward',$3,$4,$5,'referral_registration',$6,$7,$8)`,
  [randomUUID(), owner.id, REFERRAL_REWARD_POINTS, updated.paid_points, updated.monthly_points, registration.id,
    `referral:reward:${registration.id}`, JSON.stringify({ rewardPoints: REFERRAL_REWARD_POINTS, rewardLimit: REFERRAL_REWARD_LIMIT })]);
  await client.query("UPDATE app.referral_registration SET status='rewarded',points=$2,rewarded_at=now() WHERE id=$1", [registration.id, REFERRAL_REWARD_POINTS]);
}

/** Called from the binding transaction; accepts only server-verified binding keys. */
export async function qualifyReferral(userId: string, bindingKey: string, existing?: PoolClient): Promise<void> {
  await transaction(async client => {
    const state = await campaign(client);
    const { rows: [binding] } = await client.query("SELECT user_id,created_at FROM public.skland_binding WHERE binding_key=$1", [bindingKey]);
    if (!binding || binding.user_id !== userId) return;
    // Only a fresh, consent-checked Skland authorization may begin permanent
    // identity retention. A summary request must not copy legacy bindings.
    if (existing) await client.query(`INSERT INTO app.referral_identity (binding_key,first_user_id,first_seen_at)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [bindingKey, userId, binding.created_at]);
    const { rows: [identity] } = await client.query("SELECT * FROM app.referral_identity WHERE binding_key=$1 FOR UPDATE", [bindingKey]);
    if (!identity) return;
    await capture(client, userId);
    const invitee = await client.query(`SELECT id FROM public."user" WHERE id=$1 AND email_verified=true AND ${ACTIVE_ACCOUNT}`, [userId]);
    if (!invitee.rowCount) return;
    const { rows: [registration] } = await client.query<Registration>("SELECT * FROM app.referral_registration WHERE invitee_user_id=$1 FOR UPDATE", [userId]);
    if (!registration || !["pending", "qualified"].includes(registration.status)) return;
    if (registration.status === "pending") {
      if (identity.first_user_id !== userId || identity.first_user_id === registration.inviter_user_id || +identity.first_seen_at < +registration.created_at) {
        await client.query("UPDATE app.referral_registration SET status='rejected',reason='identity_used' WHERE id=$1", [registration.id]);
        return;
      }
      const { rows: prior } = await client.query("SELECT id FROM app.referral_registration WHERE binding_key=$1 AND id<>$2", [bindingKey, registration.id]);
      if (prior.length) {
        await client.query("UPDATE app.referral_registration SET status='rejected',reason='identity_used' WHERE id=$1", [registration.id]);
        return;
      }
      await client.query("UPDATE app.referral_registration SET status='qualified',qualified_at=now(),binding_key=$2 WHERE id=$1", [registration.id, bindingKey]);
      registration.status = "qualified";
    }
    await award(client, registration, state.enabled);
  }, existing);
}

async function retryQualified(id: string): Promise<void> {
  await transaction(async client => {
    const state = await campaign(client);
    const { rows: [registration] } = await client.query<Registration>("SELECT * FROM app.referral_registration WHERE id=$1 FOR UPDATE", [id]);
    if (registration) await award(client, registration, state.enabled);
  });
}

export async function getReferralSummary(userId?: string | null) {
  if (userId) {
    const account = await getDatabasePool().query(`SELECT id FROM public."user" WHERE id=$1 AND ${ACTIVE_ACCOUNT}`, [userId]);
    if (!account.rowCount) throw new ReferralError("网站账号不可用，请重新登录。");
    await captureReferralForNewUser(userId);
    // A previous post-create callback may have failed. The immutable signup
    // marker and verified binding are sufficient to safely recover it here.
    const bindings = await getDatabasePool().query("SELECT binding_key FROM public.skland_binding WHERE user_id=$1 ORDER BY created_at,binding_key", [userId]);
    for (const binding of bindings.rows) await qualifyReferral(userId, binding.binding_key);
    const pending = await getDatabasePool().query("SELECT id FROM app.referral_registration WHERE inviter_user_id=$1 AND status='qualified' ORDER BY qualified_at,id LIMIT 100", [userId]);
    for (const row of pending.rows) await retryQualified(row.id);
  }
  return transaction(async client => {
    const state = await campaign(client);
    const base = { enabled: state.enabled, rewardPoints: REFERRAL_REWARD_POINTS, rewardLimit: REFERRAL_REWARD_LIMIT, maxPoints: REFERRAL_REWARD_POINTS * REFERRAL_REWARD_LIMIT };
    if (!userId) return { ...base, account: null };
    let code: string | undefined;
    for (let attempt = 0; attempt < 3 && !code; attempt++) {
      await client.query("INSERT INTO app.referral_code (user_id,code) VALUES ($1,$2) ON CONFLICT DO NOTHING", [userId, randomBytes(12).toString("hex").toUpperCase()]);
      code = (await client.query("SELECT code FROM app.referral_code WHERE user_id=$1", [userId])).rows[0]?.code;
    }
    if (!code) throw new ReferralError("邀请码生成失败，请重试。");
    const { rows } = await client.query<Registration>("SELECT * FROM app.referral_registration WHERE inviter_user_id=$1 ORDER BY created_at DESC,id LIMIT 100", [userId]);
    const { rows: [totals] } = await client.query<SummaryCounts>(`SELECT ${COUNT_COLUMNS} FROM app.referral_registration WHERE inviter_user_id=$1`, [userId]);
    return { ...base, account: { code, ...totals, remainingRewards: Math.max(0, REFERRAL_REWARD_LIMIT - totals.rewardedCount),
      referrals: rows.map(row => ({ id: row.id, createdAt: row.created_at.toISOString(), qualifiedAt: row.qualified_at?.toISOString() ?? null,
        rewardedAt: row.rewarded_at?.toISOString() ?? null, status: row.status, points: row.points })) } };
  });
}

export async function getReferralCampaign() {
  return transaction(async client => {
    const state = await campaign(client);
    const { rows: [stats] } = await client.query<SummaryCounts>(`SELECT ${COUNT_COLUMNS} FROM app.referral_registration`);
    return { ...state, stats: stats as SummaryCounts };
  });
}

export async function setReferralCampaign(actor: string, value: unknown) {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input.enabled !== "boolean" || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500
    || typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim() || input.idempotencyKey.length > 128
    || (input.expectedUpdatedAt !== null && typeof input.expectedUpdatedAt !== "string")) throw new ReferralError("活动配置无效，请填写操作原因并刷新后重试。");
  const reason = input.reason.trim();
  const key = `referral:campaign:${input.idempotencyKey}`;
  const fingerprint = createHash("sha256").update(JSON.stringify({ actor, enabled: input.enabled, reason, expectedUpdatedAt: input.expectedUpdatedAt })).digest("hex");
  await transaction(async client => {
    const before = await campaign(client, "update");
    const { rows: [prior] } = await client.query("SELECT details FROM app.billing_admin_audit WHERE idempotency_key=$1", [key]);
    if (prior) {
      if (prior.details.fingerprint !== fingerprint) throw new ReferralError("相同操作 ID 不能用于不同活动设置。");
      return;
    }
    if (before.updatedAt !== input.expectedUpdatedAt) throw new ReferralError("活动配置已更新，请刷新后重试。");
    await client.query(`INSERT INTO app.site_setting (key,value,updated_at) VALUES ($1,$2,clock_timestamp())
      ON CONFLICT (key) DO UPDATE SET value=excluded.value,updated_at=greatest(excluded.updated_at,site_setting.updated_at+interval '1 microsecond')`, [CAMPAIGN_KEY, JSON.stringify({ enabled: input.enabled })]);
    await client.query(`INSERT INTO app.billing_admin_audit (id,actor_id,action,target,reason,idempotency_key,details)
      VALUES ($1,$2,'referral_campaign',$3,$4,$5,$6)`, [randomUUID(), actor, CAMPAIGN_KEY, reason, key, JSON.stringify({ fingerprint, before: before.enabled, after: input.enabled })]);
  });
  return getReferralCampaign();
}
