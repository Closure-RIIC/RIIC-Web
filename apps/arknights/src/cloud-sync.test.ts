import assert from "node:assert/strict";
import test from "node:test";

import { cloudSyncMetadataKey, cloudSyncPreferenceKey, cloudWorkspaceFingerprint, readCloudSyncMetadata, writeCloudSyncMetadata } from "./cloud-sync.ts";
import type { CloudWorkspacePutRequest } from "./types.ts";
import type { TestContext } from "node:test";
import { CloudSyncSession, type CloudSyncStatus, type CloudUpload } from "./cloud-sync-session.ts";
import type { CloudWorkspaceData } from "./types.ts";

const request = {
  state: {
    presetLabel: "243",
    layout: { template: "243", drone_cap: 0, scenario: {}, rooms: [] },
    sourceName: null,
    boxSource: "sample",
    layoutDirty: false,
    layoutSource: "local",
    localLayoutBackup: null,
    rotationProfile: "abc_12_6_6",
    fiammettaEnabled: false,
    activeShift: 0,
  },
  operbox: null,
  result: null,
} satisfies Exclude<CloudWorkspacePutRequest, { restoreRevisionId: string }>;

test("cloud fingerprint changes with local edits", () => {
  assert.notEqual(cloudWorkspaceFingerprint(request), cloudWorkspaceFingerprint({
    ...request,
    state: { ...request.state, activeShift: 1 },
  }));
});

test("cloud sync metadata is scoped per website user", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  writeCloudSyncMetadata(storage, "user-a", { revision: 3, fingerprint: "fp" });
  assert.deepEqual(readCloudSyncMetadata(storage, "user-a"), { revision: 3, fingerprint: "fp" });
  assert.equal(readCloudSyncMetadata(storage, "user-b"), null);
  assert.notEqual(cloudSyncMetadataKey("user-a"), cloudSyncMetadataKey("user-b"));
});

function sessionHarness(context: TestContext, overrides: Partial<ConstructorParameters<typeof CloudSyncSession>[0]> = {}) {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100_000 });
  let workspace: CloudUpload = structuredClone(request);
  const values = new Map<string, string>();
  const uploads: CloudUpload[] = [];
  const changes: (CloudWorkspaceData | null)[] = [];
  const statuses: CloudSyncStatus[] = [];
  const remote: CloudWorkspaceData = { exists: false, revision: 0, state: null, operbox: null, result: null, revisions: [], updatedAt: null, syncedAt: null };
  const dependencies: ConstructorParameters<typeof CloudSyncSession>[0] = {
    userId: "user-a",
    dismissedKey: "dismissed:a:v1",
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
    local: () => ({ workspace, hasLocalSession: true }),
    getConsent: async () => ({ current: true, cloudSyncEnabled: true, termsVersion: "1", privacyVersion: "1", acceptedAt: null, revokedAt: null }),
    acceptConsent: async () => undefined,
    getWorkspace: async () => remote,
    putWorkspace: async (input) => { uploads.push(input); return { ...remote, ...input, exists: true, revision: uploads.length }; },
    apply: (data) => { workspace = { state: data.state!, operbox: data.operbox, result: data.result }; },
    changed: (data) => changes.push(data),
    status: (state) => statuses.push(state),
    ...overrides,
  };
  const session = new CloudSyncSession(dependencies);
  context.after(() => session.dispose());
  const tick = async (ms: number) => {
    context.mock.timers.tick(ms);
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };
  return { session, dependencies, values, uploads, changes, statuses, remote, tick, edit: (shift: number) => {
    workspace = { ...workspace, state: { ...workspace.state, activeShift: shift } };
    session.update();
  } };
}

test("expired cloud consent stops uploads until explicit acceptance", async (context) => {
  let accepted = false;
  let attempts = 0;
  const h = sessionHarness(context, {
    putWorkspace: async () => { attempts++; if (!accepted) throw { code: "AIC-DATA-8001" }; return h.remote; },
    acceptConsent: async () => { accepted = true; },
  });
  h.session.start(); await h.tick(0);
  assert.equal(attempts, 1);
  assert.equal(h.statuses.at(-1)?.consentOpen, true);
  h.edit(1); await h.tick(120_000);
  assert.equal(attempts, 1);
  await h.session.accept(); await h.tick(0);
  assert.equal(attempts, 2);
  assert.equal(h.statuses.at(-1)?.error, null);
});

test("429 cooldown survives local edits and manual retries", async (context) => {
  let attempts = 0;
  const h = sessionHarness(context, { putWorkspace: async () => {
    attempts++;
    if (attempts === 1) throw { code: "AIC-RATE-6001", retryAfterSeconds: 60 };
    return h.remote;
  } });
  h.session.start(); await h.tick(0);
  h.edit(1); h.session.retry(); await h.tick(59_999);
  assert.equal(attempts, 1);
  await h.tick(1);
  assert.equal(attempts, 2);
  assert.equal(h.statuses.at(-1)?.error, null);
});

test("invalid uploads are blocked by fingerprint and resume only for changed data", async (context) => {
  let attempts = 0;
  const h = sessionHarness(context, { putWorkspace: async () => { attempts++; throw { code: "AIC-DATA-8003" }; } });
  h.session.start(); await h.tick(0);
  h.session.update(); h.session.retry(); await h.tick(120_000);
  assert.equal(attempts, 1);
  h.edit(1); await h.tick(1200);
  assert.equal(attempts, 2);
  assert.equal(h.statuses.at(-1)?.error, "invalid");
});

test("transient failures use bounded exponential retry and then pause", async (context) => {
  let attempts = 0;
  const h = sessionHarness(context, { getConsent: async () => { attempts++; throw { retryable: true }; } });
  h.session.start(); await h.tick(0);
  for (const delay of [5000, 10_000, 20_000, 40_000]) await h.tick(delay);
  assert.equal(attempts, 5);
  assert.equal(h.statuses.at(-1)?.error, "paused");
  h.edit(1); await h.tick(300_000);
  assert.equal(attempts, 5);
});

test("login expiry does not retry even when workspace changes", async (context) => {
  let attempts = 0;
  const h = sessionHarness(context, { getConsent: async () => { attempts++; throw { code: "AIC-AUTH-2008" }; } });
  h.session.start(); await h.tick(0);
  h.edit(1); h.session.retry(); await h.tick(300_000);
  assert.equal(attempts, 1);
  assert.equal(h.statuses.at(-1)?.error, "session");
});

test("edits during upload serialize one later upload of the latest workspace", async (context) => {
  let release!: (remote: CloudWorkspaceData) => void;
  const uploads: CloudUpload[] = [];
  const h = sessionHarness(context, { putWorkspace: async (input) => {
    uploads.push(input);
    if (uploads.length === 1) return new Promise((resolve) => { release = resolve; });
    return h.remote;
  } });
  h.session.start(); await h.tick(0);
  h.edit(1); h.edit(2); await h.tick(10_000);
  assert.equal(uploads.length, 1);
  release(h.remote); await h.tick(0); await h.tick(1200);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[1].state.activeShift, 2);
});

test("account disposal aborts requests and ignores late replies", async (context) => {
  let release!: (remote: CloudWorkspaceData) => void;
  let signal!: AbortSignal;
  const h = sessionHarness(context, { putWorkspace: async (_input, requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve) => { release = resolve; });
  } });
  h.session.start(); await h.tick(0);
  h.session.dispose();
  const statusCount = h.statuses.length;
  release(h.remote); await h.tick(120_000);
  assert.equal(signal.aborted, true);
  assert.equal(h.statuses.length, statusCount);
  assert.deepEqual(h.changes, [null]);
});

test("explicit refresh rechecks cloud consent without bypassing failure cooldown", async (context) => {
  let reads = 0;
  let current = true;
  const h = sessionHarness(context, { getConsent: async () => {
    reads++;
    return { current, cloudSyncEnabled: true, termsVersion: "1", privacyVersion: "1", acceptedAt: null, revokedAt: null };
  } });
  h.session.start(); await h.tick(0);
  current = false;
  h.session.refresh(); await h.tick(0);
  assert.equal(reads, 2);
  assert.equal(h.statuses.at(-1)?.error, "consent");
  h.session.decline(); h.session.refresh(); await h.tick(120_000);
  assert.equal(reads, 2);
});

test("stale policy versions require refresh instead of repeated consent submissions", async (context) => {
  let submissions = 0;
  const h = sessionHarness(context, {
    getConsent: async () => ({ current: false, cloudSyncEnabled: true, termsVersion: "2", privacyVersion: "2", acceptedAt: null, revokedAt: null }),
    acceptConsent: async () => { submissions++; throw { code: "AIC-DATA-8003" }; },
  });
  h.session.start(); await h.tick(0);
  await h.session.accept(); await h.session.accept(); h.edit(1); await h.tick(120_000);
  assert.equal(submissions, 1);
  assert.equal(h.statuses.at(-1)?.error, "policy");
  assert.equal(h.uploads.length, 0);
});

test("each upload uses this session's last acknowledged revision", async (context) => {
  const h = sessionHarness(context);
  h.session.start(); await h.tick(0);
  h.edit(1); await h.tick(1200);
  h.edit(2); await h.tick(1200);
  assert.deepEqual(h.uploads.map(upload => upload.baseRevision), [0, 1, 2]);
  assert.equal(h.statuses.at(-1)?.sync, "synced");
});

test("a new device with local data pauses before replacing an existing remote workspace", async (context) => {
  const h = sessionHarness(context);
  Object.assign(h.remote, { exists: true, revision: 5, state: { ...request.state, activeShift: 2 } });
  h.session.start(); await h.tick(0);
  assert.equal(h.statuses.at(-1)?.sync, "conflict");
  h.session.retry(); h.edit(1); await h.tick(120_000);
  assert.equal(h.uploads.length, 0);
  await h.session.resolveConflict("local");
  assert.equal(h.uploads[0].baseRevision, 5);
  assert.equal(h.uploads[0].state.activeShift, 1);
});

test("choosing the remote version applies it without uploading local data", async (context) => {
  const h = sessionHarness(context);
  Object.assign(h.remote, { exists: true, revision: 5, state: { ...request.state, activeShift: 2 } });
  h.session.start(); await h.tick(0);
  await h.session.resolveConflict("remote"); await h.tick(1200);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.statuses.at(-1)?.sync, "synced");
  h.edit(1); await h.tick(1200);
  assert.equal(h.uploads[0].baseRevision, 5);
});

test("another tab's metadata cannot advance this page's upload baseline", async (context) => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const h = sessionHarness(context, { storage });
  h.session.start(); await h.tick(0);
  writeCloudSyncMetadata(storage, "user-a", { revision: 99, fingerprint: "another tab" });
  h.edit(1); await h.tick(1200);
  assert.equal(h.uploads[1].baseRevision, 1);
});

test("a conflict during explicit replacement pauses again without automatic retry", async (context) => {
  let attempts = 0;
  const h = sessionHarness(context, { putWorkspace: async () => { attempts++; throw { code: "AIC-DATA-8005" }; } });
  Object.assign(h.remote, { exists: true, revision: 5, state: { ...request.state, activeShift: 2 } });
  h.session.start(); await h.tick(0);
  await h.session.resolveConflict("local"); await h.tick(120_000);
  assert.equal(attempts, 1);
  assert.equal(h.statuses.at(-1)?.sync, "conflict");
});

test("full browser storage does not cause an acknowledged write to be uploaded again", async (context) => {
  const h = sessionHarness(context, { storage: { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } } });
  h.session.start(); await h.tick(0);
  h.session.update(); await h.tick(1200);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.statuses.at(-1)?.sync, "synced");
});

test("declining consent clears the warning and keeps edits, refreshes and retries local", async (context) => {
  let reads = 0;
  const h = sessionHarness(context, { getConsent: async () => {
    reads++;
    return { current: false, cloudSyncEnabled: true, termsVersion: "1", privacyVersion: "1", acceptedAt: null, revokedAt: null };
  } });
  h.session.start(); await h.tick(0);
  assert.equal(h.statuses.at(-1)?.consentOpen, true);
  h.session.decline();
  h.edit(1); h.session.refresh(); h.session.retry(); await h.session.accept(); await h.tick(300_000);
  assert.deepEqual(h.statuses.at(-1), { consentOpen: false, saving: false, error: null, errorCode: null, sync: "local-only" });
  assert.equal(reads, 1);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.dependencies.local().workspace.state.activeShift, 1);
});

test("local-only survives a new session and policy version, and is scoped to its account", async (context) => {
  let reads = 0;
  const h = sessionHarness(context, { getConsent: async () => { reads++; throw new Error("network unavailable"); } });
  h.session.decline(); h.session.dispose();
  const restored = new CloudSyncSession({ ...h.dependencies, dismissedKey: "dismissed:a:v2" });
  context.after(() => restored.dispose());
  restored.start(); await h.tick(300_000);
  assert.equal(reads, 0);
  assert.equal(h.statuses.at(-1)?.sync, "local-only");
  const otherAccount = new CloudSyncSession({ ...h.dependencies, userId: "user-b", dismissedKey: "dismissed:b:v2" });
  context.after(() => otherAccount.dispose());
  otherAccount.start(); await h.tick(0);
  assert.equal(reads, 1);
});

test("legacy local-only dismissals migrate without asking for consent or syncing", async (context) => {
  let reads = 0;
  const h = sessionHarness(context, { getConsent: async () => { reads++; throw new Error("must not fetch"); } });
  h.values.set("dismissed:a:v1", "1");
  h.session.start(); await h.tick(300_000);
  assert.equal(reads, 0);
  assert.equal(h.values.get(cloudSyncPreferenceKey("user-a")), "local-only");
  assert.equal(h.statuses.at(-1)?.error, null);
});

test("explicit re-enabling checks consent and resumes only after acceptance", async (context) => {
  let accepted = false;
  const h = sessionHarness(context, {
    getConsent: async () => ({ current: accepted, cloudSyncEnabled: true, termsVersion: "1", privacyVersion: "1", acceptedAt: null, revokedAt: null }),
    acceptConsent: async () => { accepted = true; },
  });
  h.session.decline();
  h.values.set(cloudSyncPreferenceKey("user-a"), "sync");
  h.session.refresh(); await h.tick(0);
  assert.equal(h.statuses.at(-1)?.consentOpen, true);
  assert.equal(h.uploads.length, 0);
  await h.session.accept(); await h.tick(0);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.statuses.at(-1)?.sync, "synced");
});

test("switching to local-only aborts in-flight uploads and ignores late responses", async (context) => {
  let release!: (remote: CloudWorkspaceData) => void;
  let signal!: AbortSignal;
  const h = sessionHarness(context, { putWorkspace: async (_input, requestSignal) => {
    signal = requestSignal;
    return new Promise(resolve => { release = resolve; });
  } });
  h.session.start(); await h.tick(0);
  h.values.set(cloudSyncPreferenceKey("user-a"), "local-only");
  h.session.refresh();
  assert.equal(signal.aborted, true);
  release(h.remote); await h.tick(300_000);
  assert.deepEqual(h.changes, [null]);
  assert.equal(h.values.has(cloudSyncMetadataKey("user-a")), false);
  assert.equal(h.statuses.at(-1)?.sync, "local-only");
});

test("local-only ignores late remote restores and failed consent requests", async (context) => {
  let release!: (remote: CloudWorkspaceData) => void;
  let reject!: (cause: unknown) => void;
  let applied = 0;
  const h = sessionHarness(context, {
    local: () => ({ workspace: request, hasLocalSession: false }),
    getWorkspace: async () => new Promise(resolve => { release = resolve; }),
    acceptConsent: async () => new Promise((_resolve, fail) => { reject = fail; }),
    apply: () => { applied++; },
  });
  h.session.start(); await h.tick(0);
  h.session.decline();
  release({ ...h.remote, exists: true, revision: 3, state: { ...request.state, activeShift: 2 } }); await h.tick(0);
  assert.equal(applied, 0);
  h.values.set(cloudSyncPreferenceKey("user-a"), "sync");
  h.session.refresh();
  const accepting = h.session.accept();
  h.session.decline();
  reject({ code: "AIC-DATA-8003" }); await accepting; await h.tick(300_000);
  assert.equal(h.statuses.at(-1)?.error, null);
  assert.equal(h.statuses.at(-1)?.sync, "local-only");
});

test("local-only still stops this session when preference storage is full", async (context) => {
  let reads = 0;
  const h = sessionHarness(context, {
    storage: { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } },
    getConsent: async () => { reads++; throw new Error("must not fetch"); },
  });
  h.session.decline(); h.session.start(); h.session.refresh(); h.edit(2); await h.tick(300_000);
  assert.equal(reads, 0);
  assert.equal(h.statuses.at(-1)?.sync, "local-only");
});
