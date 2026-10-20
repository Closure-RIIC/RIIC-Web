import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { URL } from "node:url";
import process from "node:process";
import test from "node:test";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL?.trim();
if (!databaseUrl || !/(?:test|integration)/i.test(new URL(databaseUrl).pathname)) {
  throw new Error("An explicitly isolated AUTH_INTEGRATION_DATABASE_URL with a test database name is required.");
}
process.env.DATABASE_URL = databaseUrl;
process.env.BETA_BUSINESS_DB_ENABLED = "1";
process.env.ACCOUNT_CLOUD_SYNC_ENABLED = "1";
const serverOnlyHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { shortCircuit: true, url: "data:text/javascript,export{}" }
      : nextResolve(specifier, context);
  },
});
const { getDatabase, getDatabasePool } = await import("./db/index.ts");
const schema = await import("./db/schema.ts");
const { acceptAccountDataConsent } = await import("./data-consent.ts");
const { PRIVACY_VERSION, TERMS_VERSION } = await import("../../../../packages/platform/legal-policy.ts");
const { getWorkspace, putWorkspace } = await import("./workspace.ts");
test.after(async () => {
  await getDatabasePool().end();
  serverOnlyHook.deregister();
});

test("concurrent workspace writes have one winner and stale requests leave data and attachments unchanged", async () => {
  const db = getDatabase();
  const userId = randomUUID();
  await db.insert(schema.user).values({ id: userId, name: "Workspace test", email: `${userId}@example.test`, emailVerified: true });
  try {
    await acceptAccountDataConsent(userId, { termsAccepted: true, privacyAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
    const input = {
      state: {
        presetLabel: "243",
        layout: { template: "243", drone_cap: 235, scenario: {}, rooms: [
          { id: "control", kind: "control_center", level: 5 },
          { id: "power", kind: "power_plant", level: 3 },
        ] },
        sourceName: null, boxSource: "sample", layoutDirty: false, layoutSource: "local",
        localLayoutBackup: null, rotationProfile: "abc_12_6_6", fiammettaEnabled: false, activeShift: 0,
      },
      operbox: null, result: null,
    };
    const first = await putWorkspace(userId, { ...input, baseRevision: 0 });
    assert.equal(first.revision, 1);
    const contenders = ["device-a", "device-b"].map((sourceName) => ({ ...input, baseRevision: 1, state: { ...input.state, sourceName } }));
    const results = await Promise.allSettled(contenders.map((value) => putWorkspace(userId, value)));
    const winners = results.filter((entry) => entry.status === "fulfilled");
    const losers = results.filter((entry) => entry.status === "rejected");
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].reason.code, "AIC-DATA-8005");
    assert.equal(losers[0].reason.status, 409);
    const winner = winners[0].value;
    assert.equal(winner.revision, 2);
    assert.equal(winner.state.sourceName, contenders[results.findIndex((entry) => entry.status === "fulfilled")].state.sourceName);

    // The stale MAA upload must be rejected before storing its encrypted BOX.
    await assert.rejects(putWorkspace(userId, {
      ...input, baseRevision: 1, state: { ...input.state, boxSource: "maa" },
      operbox: [{ id: "char_1", name: "测试干员", elite: 2, level: 80, own: true, potential: 1, rarity: 6 }],
    }), { code: "AIC-DATA-8005" });
    await assert.rejects(putWorkspace(userId, input), { code: "AIC-DATA-8005" });
    const current = await getWorkspace(userId);
    assert.equal(current.revision, 2);
    assert.deepEqual(current.state, winner.state);
    assert.equal((await db.select().from(schema.operboxSnapshot).where(eq(schema.operboxSnapshot.userId, userId))).length, 0);
    assert.equal(current.revisions.length, 1);
    await assert.rejects(putWorkspace(userId, { restoreRevisionId: current.revisions[0].id, baseRevision: 1 }), { code: "AIC-DATA-8005" });
    const restored = await putWorkspace(userId, { restoreRevisionId: current.revisions[0].id, baseRevision: 2 });
    assert.equal(restored.revision, 3);
    assert.deepEqual(restored.state, first.state);
  } finally {
    await db.delete(schema.user).where(eq(schema.user.id, userId));
  }
});
