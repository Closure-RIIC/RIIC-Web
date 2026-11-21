import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register, registerHooks } from "node:module";
import process from "node:process";
import test from "node:test";
import { URL, URLSearchParams } from "node:url";
import { Client } from "pg";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Isolated *_test database required");
process.env.DATABASE_URL = url;
const { getDatabasePool } = await import("@riic/platform-server/db");
const { activeAgentPolicies, beginAgentRun } = await import("./agent-accounting.ts");
const { billingOverview, billingRunDetail, changeAgentModelSettings, changeAgentPolicy, getAgentPolicies, listBilling, resolveBillingReview } = await import("./admin.ts");
const { activeAgentModels } = await import("../agent/model-catalog.ts");
const { defaultRatePolicy } = await import("./rate-policy.ts");
const { defaultModelPolicy } = await import("../agent/model-policy.ts");

test("model catalog bootstrap, history and publication keep a usable active configuration", async t => {
  const pool = getDatabasePool();
  const actor = `model-admin-${randomUUID()}`;
  const originalEnv = { ...process.env };
  process.env.AGENT_GATEWAY_MODELS = "deepseek,glm,gpt";
  process.env.AGENT_LLM_DEEPSEEK_MODEL = "deepseek-v4.1-flash";
  process.env.AGENT_LLM_GLM_MODEL = "glm-5.3-flash";
  process.env.AGENT_LLM_GPT_MODEL = "gpt-6.1-sol";
  process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED = "0";
  try {
    await pool.query('INSERT INTO public."user" (id,name,email,role) VALUES ($1,$1,$2,\'admin\')', [actor, `${actor}@example.test`]);
    // Exercise a fresh/unpublished billing state while preserving old snapshots.
    await pool.query("UPDATE app.agent_policy_version SET status='retired' WHERE kind IN ('rates','models') AND status='active'");
    const initial = await getAgentPolicies();
    if (!initial.modelSettings.active) {
      const initialPayload = globalThis.structuredClone(initial.modelSettings.initialPayload);
      assert.equal(initialPayload.rates.markup, "");
      await assert.rejects(activeAgentPolicies(), error => error.code === "policy_unavailable");
      initialPayload.rates = defaultRatePolicy("1.2");
      const saved = await changeAgentModelSettings(actor, { action: "draft", payload: initialPayload, expectedActive: initial.modelSettings.expectedActive, reason: "initial explicit billing configuration" });
      assert.equal((await getAgentPolicies()).modelSettings.active, null);
      await assert.rejects(activeAgentPolicies(), error => error.code === "policy_unavailable");
      await changeAgentModelSettings(actor, { action: "publish", id: saved.id, expectedActive: initial.modelSettings.expectedActive, reason: "publish initial explicit billing configuration" });
      await assert.rejects(changeAgentModelSettings(actor, { action: "draft", payload: initialPayload, expectedActive: initial.modelSettings.expectedActive, reason: "stale empty-state request" }), /已更新/);
    }
    const baseline = await activeAgentPolicies();
    await t.test("every enabled default-group fallback requires its own rate on publish and rollback", async () => {
      process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED = "1";
      process.env.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL = "deepseek-flash";
      try {
        const missingOfficial = globalThis.structuredClone(baseline.rates.policy);
        missingOfficial.models = missingOfficial.models.filter(row => row.provider !== "riic-deepseek-official");
        const draft = await changeAgentPolicy(actor, { kind: "rates", action: "draft", payload: missingOfficial, expectedActive: baseline.rates.id, reason: "missing official rate fixture" });
        for (const action of ["publish", "rollback"]) await assert.rejects(changeAgentPolicy(actor, { kind: "rates", action, id: draft.id, expectedActive: baseline.rates.id, reason: "reject unpriced default fallback" }), /未完整配置/);
        assert.equal((await activeAgentPolicies()).rates.id, baseline.rates.id);
      } finally { process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED = "0"; }
    });
    let catalog;
    await t.test("a first saved draft survives concurrent initialization of the active catalog", async () => {
      // Simulate an interrupted/bootstrap state without discarding historical snapshots.
      await pool.query("UPDATE app.agent_policy_version SET status='retired' WHERE kind='models' AND status='active'");
      const priorVersion = Number((await pool.query("SELECT coalesce(max(version),0) AS n FROM app.agent_policy_version WHERE kind='models'")).rows[0].n);
      const draftPayload = defaultModelPolicy(); draftPayload.models[0].label = "Saved before initialization";
      const draft = await changeAgentPolicy(actor, { kind: "models", action: "draft", payload: draftPayload, reason: "first API draft" });
      assert.equal(draft.id, `models:${priorVersion + 1}`);
      const concurrent = await Promise.all(Array.from({ length: 4 }, () => activeAgentModels()));
      assert.equal(new Set(concurrent.map(row => row.id)).size, 1);
      catalog = concurrent[0];
      assert.equal(catalog.id, `models:${priorVersion + 2}`);
      const storedDraft = (await pool.query("SELECT status,payload FROM app.agent_policy_version WHERE id=$1", [draft.id])).rows[0];
      assert.equal(storedDraft.status, "draft"); assert.deepEqual(storedDraft.payload, draftPayload);
      assert.notEqual(catalog.policy.models[0].label, draftPayload.models[0].label);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.agent_policy_version WHERE kind='models' AND status='active'")).rows[0].n, 1);
    });

    await t.test("active versions remain in admin results after more than 100 later drafts", async () => {
      for (const [kind, count, payload] of [["filter", 110, baseline.filter.policy], ["rates", 40, baseline.rates.policy], ["models", 40, catalog.policy]]) {
        await pool.query(`WITH base AS (SELECT coalesce(max(version),0) AS n FROM app.agent_policy_version WHERE kind=$1)
          INSERT INTO app.agent_policy_version (id,kind,version,status,payload,author_id,created_at)
          SELECT $1||':'||(base.n+series.n),$1,base.n+series.n,'draft',$2,$3,now()+series.n*interval '1 second'
          FROM base CROSS JOIN generate_series(1,$4::integer) AS series(n)`, [kind, JSON.stringify(payload), actor, count]);
      }
      const result = await getAgentPolicies();
      for (const id of [baseline.rates.id, baseline.filter.id, catalog.id]) assert.ok(result.versions.some(row => row.id === id && row.status === "active"));
      for (const kind of ["rates", "filter", "models"]) assert.equal(result.versions.filter(row => row.kind === kind).length, 34);
      assert.equal(result.models.length, 3);
    });

    await t.test("GPT publication requires its route, published price and image budget at publication time", async () => {
      const enabled = globalThis.structuredClone(catalog.policy);
      const gpt = enabled.models.find(row => row.id === "gpt");
      gpt.enabled = true; gpt.imageTokensPerImage = 5000;
      const draft = await changeAgentPolicy(actor, { kind: "models", action: "draft", payload: enabled, expectedActive: catalog.id, reason: "enable GPT fixture" });
      const publish = id => changeAgentPolicy(actor, { kind: "models", action: "publish", id, expectedActive: catalog.id, reason: "publish fixture" });
      await assert.rejects(publish(draft.id), /未完整配置/);
      assert.equal((await activeAgentModels()).id, catalog.id);

      // Synthetic fixture prices, never a provider quote or a deployment default.
      const rates = globalThis.structuredClone(baseline.rates.policy);
      rates.models.push({ provider: "riic-gpt", model: "gpt-6.1-sol", currency: "RMB", exchangeRate: "1", input: "5", cachedInput: "1", output: "15" });
      const priceDraft = await changeAgentPolicy(actor, { kind: "rates", action: "draft", payload: rates, expectedActive: baseline.rates.id, reason: "configured test prices" });
      await changeAgentPolicy(actor, { kind: "rates", action: "publish", id: priceDraft.id, expectedActive: baseline.rates.id, reason: "publish configured test prices" });
      process.env.AGENT_GATEWAY_MODELS = "deepseek,glm";
      await assert.rejects(publish(draft.id), /未完整配置/);
      process.env.AGENT_GATEWAY_MODELS = "deepseek,glm,gpt";
      const noBound = globalThis.structuredClone(enabled); noBound.models.find(row => row.id === "gpt").imageTokensPerImage = 0;
      const noBoundDraft = await changeAgentPolicy(actor, { kind: "models", action: "draft", payload: noBound, expectedActive: catalog.id, reason: "missing supplier bound" });
      await assert.rejects(publish(noBoundDraft.id), /未完整配置/);
      assert.equal((await pool.query("SELECT status FROM app.agent_policy_version WHERE id=$1", [noBoundDraft.id])).rows[0].status, "draft");

      const competing = await Promise.allSettled([publish(draft.id), publish(draft.id)]);
      assert.equal(competing.filter(row => row.status === "fulfilled").length, 1);
      assert.equal((await activeAgentModels()).id, draft.id);
      assert.equal((await getAgentPolicies()).models.find(row => row.id === "gpt").available, true);

      // A price rollback cannot invalidate an enabled model. Disable first.
      const rollbackPrice = () => changeAgentPolicy(actor, { kind: "rates", action: "rollback", id: baseline.rates.id, expectedActive: priceDraft.id, reason: "restore old price snapshot" });
      await assert.rejects(rollbackPrice(), /未完整配置/);
      assert.equal((await activeAgentPolicies()).rates.id, priceDraft.id);
      const disabled = await changeAgentPolicy(actor, { kind: "models", action: "rollback", id: catalog.id, expectedActive: draft.id, reason: "disable GPT before price rollback" });
      assert.equal((await activeAgentModels()).id, disabled.id);
      await rollbackPrice();
      assert.deepEqual((await activeAgentPolicies()).rates.policy, baseline.rates.policy);
      const choice = (await getAgentPolicies()).models.find(row => row.id === "gpt");
      assert.equal(choice.available, false); assert.equal(choice.reason, "disabled");
    });

    const currentSettings = async () => (await getAgentPolicies()).modelSettings;
    const expectedPair = active => ({ ratesId: active.ratesId, modelsId: active.modelsId });
    const saveSettings = (active, payload, reason = "joint settings fixture") => changeAgentModelSettings(actor, {
      action: "draft", payload, expectedActive: expectedPair(active), reason,
    });
    const publishSettings = (active, id, reason = "publish joint fixture") => changeAgentModelSettings(actor, {
      action: "publish", id, expectedActive: expectedPair(active), reason,
    });
    const originalSettings = (await currentSettings()).active;
    let jointEnabled;
    let jointPublished;

    await t.test("joint bootstrap preserves the active pair and legacy publication history", async () => {
      const reads = await Promise.all(Array.from({ length: 3 }, currentSettings));
      assert.equal(new Set(reads.map(row => row.active.id)).size, 1);
      const result = reads[0];
      assert.equal(result.active.ratesId, (await activeAgentPolicies()).rates.id);
      assert.equal(result.active.modelsId, (await activeAgentModels()).id);
      const version = result.versions.find(row => row.id === result.active.id);
      assert.deepEqual(version.payload, result.active.payload);
      assert.deepEqual({ ratesId: version.ratesId, modelsId: version.modelsId }, expectedPair(result.active));
      assert.ok(result.versions.some(row => row.status === "retired" && row.payload.models.models.find(model => model.id === "gpt").enabled));
      assert.equal("linkedVersions" in result.active.payload, false);
    });

    await t.test("one publication enables GPT and installs its price atomically without changing existing runs or wallets", async () => {
      jointEnabled = globalThis.structuredClone(originalSettings.payload);
      jointEnabled.models.models.find(row => row.id === "gpt").enabled = true;
      jointEnabled.models.models.find(row => row.id === "gpt").imageBudgetMode = "shared-input-limit";
      jointEnabled.models.models.find(row => row.id === "gpt").imageTokensPerImage = 0;
      jointEnabled.rates.models.push({ provider: "riic-gpt", model: "gpt-6.1-sol", currency: "RMB", exchangeRate: "1", input: "5", cachedInput: "1", output: "15" });
      const oldPolicies = await activeAgentPolicies();
      const runId = await beginAgentRun({ userId: actor, conversationId: randomUUID(), idempotencyKey: randomUUID(), requestHash: "joint-settings-fixture",
        rates: oldPolicies.rates, filterVersion: oldPolicies.filter.id, modelSelection: { policyVersion: originalSettings.modelsId } });
      const runBefore = (await pool.query("SELECT policy,rate_version,model_selection FROM app.agent_run WHERE id=$1", [runId])).rows[0];
      const walletBefore = (await pool.query("SELECT * FROM app.billing_wallet WHERE user_id=$1", [actor])).rows[0];
      const draft = await saveSettings(originalSettings, jointEnabled);
      assert.deepEqual((await currentSettings()).active, originalSettings);
      jointPublished = await publishSettings(originalSettings, draft.id);
      const result = await getAgentPolicies();
      assert.equal(result.modelSettings.active.id, draft.id);
      assert.notEqual(jointPublished.ratesId, originalSettings.ratesId);
      assert.notEqual(jointPublished.modelsId, originalSettings.modelsId);
      assert.deepEqual(result.modelSettings.active.payload, jointEnabled);
      assert.equal(result.models.find(row => row.id === "gpt").available, true);
      assert.equal((await activeAgentPolicies()).rates.id, jointPublished.ratesId);
      assert.equal((await activeAgentModels()).id, jointPublished.modelsId);
      const runtime = await activeAgentPolicies();
      assert.equal(runtime.models.id, jointPublished.modelsId);
      assert.equal(runtime.rates.id, jointPublished.ratesId);
      assert.deepEqual((await pool.query("SELECT policy,rate_version,model_selection FROM app.agent_run WHERE id=$1", [runId])).rows[0], runBefore);
      assert.deepEqual((await pool.query("SELECT * FROM app.billing_wallet WHERE user_id=$1", [actor])).rows[0], walletBefore);
      const audited = (await pool.query("SELECT details FROM app.billing_admin_audit WHERE target=$1 AND action='model_settings_publish'", [draft.id])).rows[0];
      assert.deepEqual(audited.details.previous, { id: originalSettings.id, ...expectedPair(originalSettings) });
      assert.equal(audited.details.ratesId, jointPublished.ratesId);
      assert.equal(audited.details.modelsId, jointPublished.modelsId);
    });

    await t.test("joint rollback restores both parts using new snapshots and rejects stale IDs independently", async () => {
      const active = (await currentSettings()).active;
      for (const expectedActive of [
        { ratesId: originalSettings.ratesId, modelsId: active.modelsId },
        { ratesId: active.ratesId, modelsId: originalSettings.modelsId },
      ]) await assert.rejects(changeAgentModelSettings(actor, { action: "draft", payload: active.payload, expectedActive, reason: "stale pair fixture" }), /已更新/);
      const restored = await changeAgentModelSettings(actor, { action: "rollback", id: originalSettings.id, expectedActive: expectedPair(active), reason: "restore baseline pair" });
      const result = await currentSettings();
      assert.deepEqual(result.active.payload, originalSettings.payload);
      assert.notEqual(restored.ratesId, originalSettings.ratesId);
      assert.notEqual(restored.modelsId, originalSettings.modelsId);
      assert.equal(result.versions.find(row => row.id === originalSettings.id).status, "retired");
      assert.deepEqual(result.versions.find(row => row.id === jointPublished.id).payload, jointEnabled);
    });

    await t.test("invalid combined publication changes neither active part and retains its draft", async () => {
      const active = (await currentSettings()).active;
      const invalid = globalThis.structuredClone(jointEnabled); invalid.rates.models = invalid.rates.models.filter(row => row.provider !== "riic-gpt");
      const draft = await saveSettings(active, invalid);
      const rowsBefore = (await pool.query("SELECT count(*)::int AS n FROM app.agent_policy_version")).rows[0].n;
      await assert.rejects(publishSettings(active, draft.id), /未完整配置/);
      assert.deepEqual((await currentSettings()).active, active);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.agent_policy_version")).rows[0].n, rowsBefore);
      assert.equal((await pool.query("SELECT status FROM app.agent_policy_version WHERE id=$1", [draft.id])).rows[0].status, "draft");
      await assert.rejects(changeAgentModelSettings(actor, { action: "rollback", id: draft.id, expectedActive: expectedPair(active), reason: "cannot roll back an unpublished draft" }), /尚未发布/);
      const readyDraft = await saveSettings(active, jointEnabled);
      process.env.AGENT_GATEWAY_MODELS = "deepseek,glm";
      await assert.rejects(publishSettings(active, readyDraft.id), /未完整配置/);
      process.env.AGENT_GATEWAY_MODELS = "deepseek,glm,gpt";
      assert.deepEqual((await currentSettings()).active, active);
    });

    await t.test("a late audit failure rolls back both published snapshots and draft activation", async () => {
      const active = (await currentSettings()).active;
      const draft = await saveSettings(active, jointEnabled);
      const trigger = `joint_failure_${randomUUID().replaceAll("-", "")}`;
      const before = (await pool.query("SELECT id,status,payload FROM app.agent_policy_version ORDER BY id")).rows;
      const migrationUrl = new URL(process.env.DATABASE_MIGRATION_URL || url);
      const runtimeUrl = new URL(url);
      assert.deepEqual([migrationUrl.hostname, migrationUrl.port, migrationUrl.pathname],
        [runtimeUrl.hostname, runtimeUrl.port, runtimeUrl.pathname], "Fault injection must stay in the isolated runtime test database");
      // Fixture DDL belongs to the migration role; publication still uses the limited runtime pool.
      const migration = new Client({ connectionString: migrationUrl.toString() });
      await migration.connect();
      try {
        await migration.query(`CREATE FUNCTION app.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.action = 'model_settings_publish' AND NEW.reason = 'force joint audit rollback' THEN RAISE EXCEPTION 'forced joint audit failure'; END IF; RETURN NEW; END $$`);
        try {
          await migration.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON app.billing_admin_audit FOR EACH ROW EXECUTE FUNCTION app.${trigger}()`);
          await assert.rejects(publishSettings(active, draft.id, "force joint audit rollback"), /forced joint audit failure/);
          assert.deepEqual((await pool.query("SELECT id,status,payload FROM app.agent_policy_version ORDER BY id")).rows, before);
          assert.deepEqual((await currentSettings()).active, active);
        } finally {
          await migration.query(`DROP TRIGGER IF EXISTS ${trigger} ON app.billing_admin_audit`);
          await migration.query(`DROP FUNCTION app.${trigger}()`);
        }
      } finally {
        await migration.end();
      }
    });

    await t.test("concurrent joint publishers cannot overwrite each other and legacy writes keep the joint active pair truthful", async () => {
      const active = (await currentSettings()).active;
      const firstPayload = globalThis.structuredClone(active.payload); firstPayload.models.models[0].label = "first concurrent model label";
      const secondPayload = globalThis.structuredClone(active.payload); secondPayload.rates.markup = "1.3";
      const first = await saveSettings(active, firstPayload); const second = await saveSettings(active, secondPayload);
      const results = await Promise.allSettled([publishSettings(active, first.id), publishSettings(active, second.id)]);
      assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
      assert.equal(results.filter(row => row.status === "rejected").length, 1);
      const after = (await currentSettings()).active;
      assert.ok([first.id, second.id].includes(after.id));
      const unchangedModelsId = after.modelsId;
      const changedRates = globalThis.structuredClone(after.payload.rates); changedRates.markup = "1.4";
      const priceDraft = await changeAgentPolicy(actor, { kind: "rates", action: "draft", payload: changedRates, expectedActive: after.ratesId, reason: "legacy compatibility draft" });
      await changeAgentPolicy(actor, { kind: "rates", action: "publish", id: priceDraft.id, expectedActive: after.ratesId, reason: "legacy compatibility publication" });
      const legacy = (await currentSettings()).active;
      assert.equal(legacy.ratesId, priceDraft.id); assert.equal(legacy.modelsId, unchangedModelsId);
      assert.equal(legacy.payload.rates.markup, "1.4"); assert.notEqual(legacy.id, after.id);
      const expectedRows = (await pool.query("SELECT kind,count(*)::int AS n FROM app.agent_policy_version WHERE kind IN ('rates','models','model-settings') AND status='active' GROUP BY kind ORDER BY kind")).rows;
      assert.deepEqual(expectedRows, [{ kind: "model-settings", n: 1 }, { kind: "models", n: 1 }, { kind: "rates", n: 1 }]);
    });

    await t.test("model statistics follow the full filtered range, preserve unknown costs and trace attempts without double counting", async () => {
      const marker = `stats-${randomUUID()}`;
      const otherUser = `${marker}-other`;
      await pool.query('INSERT INTO public."user" (id,name,email) VALUES ($1,$1,$2)', [otherUser, `${otherUser}@example.test`]);
      const fixtureRates = globalThis.structuredClone(jointEnabled.rates);
      fixtureRates.models.find(row => row.provider === "riic-gpt").longContext = { inputTokenThreshold: 272000, input: "10", cachedInput: "2", output: "22.5" };
      const fixtures = [];
      for (let index = 0; index < 32; index++) {
        const missingUsage = index === 2 || index === 29;
        const unknownCost = [2, 3, 28, 29].includes(index);
        const provider = index === 29 ? null : index === 28 ? "riic-glm" : "riic-gpt";
        const model = index === 29 ? null : index === 28 ? "glm-5.3-flash" : "gpt-6.1-sol";
        const input = missingUsage ? null : index === 0 ? 272000 : index === 1 ? 272001 : index === 3 || index === 4 ? 280000 : 100 + index;
        const cached = missingUsage ? null : index === 0 ? 272000 : 10;
        const cacheWrite = missingUsage || index === 4 ? null : index === 0 || index === 28 ? 0 : 5;
        const output = missingUsage ? null : 20;
        const runId = `${marker}-run-${index}`; const callId = `${marker}-call-${index}`;
        const at = index === 31 ? "2026-11-14T12:00:00Z" : "2026-11-10T12:00:00Z";
        const policy = globalThis.structuredClone(fixtureRates);
        if (index === 4) delete policy.models.find(row => row.provider === "riic-gpt").longContext;
        const selection = { id: index === 28 ? "glm" : "gpt", label: index === 28 ? "Snapshot GLM" : "Snapshot GPT", provider, model };
        await pool.query(`INSERT INTO app.agent_run (id,user_id,conversation_id,idempotency_key,request_hash,policy,rate_version,filter_version,model_selection,state,settlement,created_at)
          VALUES ($1,$2,$1,$1,$1,$3,'fixture-rates','fixture-filter',$4,$5,$6,$7)`, [runId, index === 30 ? otherUser : actor, JSON.stringify(policy), JSON.stringify(selection), [2, 3].includes(index) ? "failed" : "completed", unknownCost ? "needs_review" : "settled", at]);
        await pool.query(`INSERT INTO app.agent_model_call (id,run_id,step,provider,model,status,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,upstream_rmb,charged_rmb,budget_points,rate_version,created_at)
          VALUES ($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,'fixture-rates',$12)`, [callId, runId, provider, model, unknownCost ? "missing" : "measured", input, cached, cacheWrite, output, unknownCost ? null : "2", unknownCost ? null : "2.4", at]);
        if (unknownCost) await pool.query("INSERT INTO app.billing_review (id,run_id,kind,evidence) VALUES ($1,$2,'missing',$3)", [`call:${callId}`, runId, JSON.stringify({ callId })]);
        fixtures.push({ callId, runId, provider, model, input, cached, cacheWrite, output });
      }
      const range = { from: "2026-11-09T00:00:00Z", to: "2026-11-12T00:00:00Z" };
      const params = new URLSearchParams({ ...range, q: actor, page: "2" });
      const usage = await listBilling("usage", params);
      assert.equal(usage.total, 30); assert.equal(usage.rows.length, 5);
      assert.equal(usage.modelStats.reduce((sum, row) => sum + row.calls, 0), 30);
      const gpt = usage.modelStats.find(row => row.provider === "riic-gpt");
      assert.equal(gpt.modelId, "gpt"); assert.equal(gpt.calls, 28);
      assert.equal(gpt.longContextCalls, 2); // Strict > threshold, and historical policies without the tier stay base.
      assert.equal(gpt.unknownUsageCalls, 1); assert.equal(gpt.unknownCostCalls, 2); assert.equal(gpt.pendingReviewCalls, 2);
      assert.equal(gpt.inputTokens, String(fixtures.slice(0, 28).reduce((sum, row) => sum + (row.input ?? 0), 0)));
      assert.equal(gpt.cachedInputTokens, String(fixtures.slice(0, 28).reduce((sum, row) => sum + (row.cached ?? 0), 0)));
      assert.equal(gpt.cacheWriteTokens, null, "a partial known subtotal must not represent the entire range");
      assert.equal(usage.modelStats.find(row => row.provider === "riic-glm").cacheWriteTokens, "0", "known zero is distinct from historical missing usage");
      assert.equal(Number(gpt.knownUpstreamRmb), 52); assert.equal(Number(gpt.knownChargedRmb), 62.4);
      const unknown = usage.modelStats.find(row => row.provider === null);
      assert.equal(unknown.modelId, null); assert.equal(unknown.inputTokens, null); assert.equal(unknown.knownUpstreamRmb, null);
      assert.equal(unknown.unknownCostCalls, 1); assert.equal(unknown.pendingReviewCalls, 1);
      const exact = await listBilling("usage", new URLSearchParams({ ...range, q: fixtures[1].runId }));
      assert.equal(exact.rows[0].selected_model_id, "gpt"); assert.equal(exact.rows[0].selected_model_label, "Snapshot GPT");
      assert.deepEqual(exact.rows[0].actual_models, [{ provider: "riic-gpt", model: "gpt-6.1-sol" }]);
      const failed = await listBilling("usage", new URLSearchParams({ ...range, q: actor, status: "failed" }));
      assert.equal(failed.total, 2); assert.equal(failed.modelStats[0].calls, 2);
      assert.equal(failed.modelStats[0].knownUpstreamRmb, null); assert.equal(failed.modelStats[0].unknownCostCalls, 2);
      const overview = await billingOverview(new Date(range.from), new Date(range.to));
      assert.equal(overview.modelStats.reduce((sum, row) => sum + row.calls, 0), 31);
      assert.equal(overview.modelStats.find(row => row.provider === "riic-gpt").calls, 29);
      assert.equal(Number(overview.modelStats.find(row => row.provider === "riic-gpt").knownUpstreamRmb), 54);
      // Overview follows completion timestamps, independently of user filters or the conversation's start date.
      await pool.query("UPDATE app.agent_model_call SET created_at='2026-11-11T12:00:00Z' WHERE id=$1", [fixtures[31].callId]);
      const callDatedOverview = await billingOverview(new Date(range.from), new Date(range.to));
      assert.equal(callDatedOverview.modelStats.reduce((sum, row) => sum + row.calls, 0), 32);
      assert.equal(Number(callDatedOverview.modelStats.find(row => row.provider === "riic-gpt").knownUpstreamRmb), 56);
      assert.equal(Number(callDatedOverview.known_cost_fen) - Number(overview.known_cost_fen), 200);
      assert.equal((await listBilling("usage", params)).modelStats.reduce((sum, row) => sum + row.calls, 0), 30);
      for (const [index, tier] of [[0, "base"], [1, "long-context"], [2, null], [4, "base"]]) {
        const detail = (await billingRunDetail(fixtures[index].runId)).calls[0];
        assert.equal(detail.pricing_tier, tier);
        assert.equal(detail.cache_write_tokens, fixtures[index].cacheWrite);
      }

      for (let index = 0; index < 4; index++) await pool.query(`INSERT INTO app.agent_gateway_usage (id,session_id,provider,model,call_id,details,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,'2026-11-10T12:00:01Z')`, [`${marker}-attempt-${index}`, marker, index === 2 || index === 3 ? "riic-glm" : "riic-gpt", index === 2 || index === 3 ? "glm-5.3-flash" : "gpt-6.1-sol", index === 3 ? null : fixtures[1].callId, JSON.stringify({ done: index === 0, status: index === 0 ? 200 : 429, cost: null })]);
      const attempts = await listBilling("attempts", new URLSearchParams({ ...range, q: marker }));
      assert.equal(attempts.total, 4); assert.equal(attempts.modelStats.length, 1); assert.equal(attempts.modelStats[0].calls, 1);
      assert.equal(attempts.modelStats[0].inputTokens, "272001"); assert.equal(Number(attempts.modelStats[0].knownUpstreamRmb), 2);
      assert.equal(attempts.modelStats[0].cacheWriteTokens, "5", "multiple gateway attempts share one completed write count");
      for (const row of attempts.rows.filter(row => row.call_id)) {
        assert.equal(row.user_id, actor); assert.equal(row.run_id, fixtures[1].runId);
        assert.equal(row.related_call.id, fixtures[1].callId); assert.equal(row.related_call.pricingTier, "long-context");
        assert.equal(row.related_call.inputTokens, 272001); assert.equal(Number(row.related_call.upstreamRmb), 2);
        assert.equal(row.related_call.cacheWriteTokens, 5);
      }
      assert.equal(attempts.rows.find(row => !row.call_id).related_call, null);
      const attemptedGlm = await listBilling("attempts", new URLSearchParams({ ...range, q: marker, status: "riic-glm" }));
      assert.equal(attemptedGlm.total, 2); assert.equal(attemptedGlm.modelStats[0].provider, "riic-gpt");
      assert.equal(attemptedGlm.modelStats[0].calls, 1); // Completion belongs to GPT; failed GLM attempt has no invented fee.

      // Review counts follow actionable review rows, not persistent settlement labels or normal in-flight calls.
      const pendingFor = async (index, status = "") => (await listBilling("usage", new URLSearchParams({ ...range, q: fixtures[index].runId, status }))).modelStats.find(row => row.provider === "riic-gpt");
      await pool.query("UPDATE app.agent_model_call SET status='started',input_tokens=NULL,cached_input_tokens=NULL,output_tokens=NULL,upstream_rmb=NULL,charged_rmb=NULL WHERE id=$1", [fixtures[5].callId]);
      await pool.query("UPDATE app.agent_run SET state='running',settlement='reserved' WHERE id=$1", [fixtures[5].runId]);
      assert.equal((await pendingFor(5)).pendingReviewCalls, 0);
      assert.equal((await pendingFor(5)).unknownCostCalls, 1);
      assert.equal((await pendingFor(3, "failed")).pendingReviewCalls, 1);
      await resolveBillingReview(actor, { id: `call:${fixtures[2].callId}`, resolution: "platform_absorbed", reason: "resolve missing usage fixture" });
      const resolvedCall = await pendingFor(2, "failed");
      assert.equal(resolvedCall.pendingReviewCalls, 0); assert.equal(resolvedCall.unknownCostCalls, 1);
      assert.equal((await pool.query("SELECT settlement FROM app.agent_run WHERE id=$1", [fixtures[2].runId])).rows[0].settlement, "needs_review");
      const runReview = `${marker}-run-review`;
      await pool.query("INSERT INTO app.billing_review (id,run_id,kind,evidence) VALUES ($1,$2,'settlement','{}')", [runReview, fixtures[6].runId]);
      assert.equal((await pendingFor(6)).pendingReviewCalls, 1);
      await resolveBillingReview(actor, { id: runReview, resolution: "verified", reason: "resolve whole-run fixture" });
      assert.equal((await pendingFor(6)).pendingReviewCalls, 0);
      await pool.query("INSERT INTO app.billing_review (id,run_id,kind,evidence) VALUES ($1,$2,'route_trace_missing',$3)", [`${marker}-other-call-review`, fixtures[6].runId, JSON.stringify({ callId: `${marker}-unrelated-call` })]);
      assert.equal((await pendingFor(6)).pendingReviewCalls, 0);
      await pool.query('DELETE FROM public."user" WHERE id=$1', [otherUser]);
    });
  } finally {
    process.env = originalEnv;
    await pool.query('DELETE FROM public."user" WHERE id=$1', [actor]);
    await pool.end();
  }
});
