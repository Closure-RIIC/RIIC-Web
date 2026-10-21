import assert from "node:assert/strict";
import test from "node:test";

import type { PublicPlanData, RotationProfile } from "./types.ts";
import { DEFAULT_ROTATION_PROFILE } from "./rotation-settings.ts";
import {
  applyLocalLayoutPatch,
  clearLocalProductData,
  loadPersistedSession,
  persistSession,
  SESSION_KEY_V2,
  SESSION_KEY_V3,
  SESSION_KEY_V4,
  SESSION_KEY_V5,
  SESSION_TTL_MS,
} from "./persistence.ts";
import { TELEMETRY_SESSION_STORAGE_KEY } from "./telemetry-contract.ts";

class MemoryStorage {
  values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException("Quota exceeded", "QuotaExceededError");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const layout = {
  template: "243",
  drone_cap: 235,
  scenario: {},
  rooms: [{ id: "control", kind: "control_center" as const, level: 5 }],
};
const operbox = [{ id: "char_1", name: "测试干员", elite: 2, level: 90, own: true, potential: 1, rarity: 6 }];
const result = {
  profile: {
    schema_version: 4,
    rotation_profile: DEFAULT_ROTATION_PROFILE,
    layout_label: "243",
    operbox_label: "示例",
    baseline_label: "产品推荐基准",
    summary: { owned: 1, tier_up_owned: 1, trade_pool_ready: 1 },
    domains: [],
    rotation: {},
    baseline_rotation: {},
    actions: [],
    flags: [],
    narration_hints: [],
  },
  maa: { title: "排班", plans: [] },
  rotation: { profile: DEFAULT_ROTATION_PROFILE, shifts: [], daily: { trade: null, manufacture: null, power: null } },
  trainingAdvice: {
    schema_version: 2 as const,
    context: {},
    newbie_section_status: "complete" as const,
    incomplete_newbie: [],
    combinations: [],
    recommendations: [],
  },
  trainingRoom: {
    schema_version: 1 as const,
    shifts: [],
  },
  durationMs: 10,
  diagnosticId: "diag",
  debug: { command: "must be removed", stdout: "secret" },
};

function resultWithShifts(count: number, rotationProfile: RotationProfile = DEFAULT_ROTATION_PROFILE): PublicPlanData {
  const durations = count === 4 ? [8, 8, 4, 4] : Array.from({ length: count }, () => 12);
  return {
    ...result,
    profile: {
      ...result.profile,
      rotation_profile: rotationProfile,
    },
    maa: {
      title: "排班",
      plans: Array.from({ length: count }, (_, index) => ({
        name: `班次 ${index + 1}`,
        rooms: {},
      })),
    },
    trainingRoom: {
      schema_version: 1,
      shifts: Array.from({ length: count }, () => ({ trainee: null, trainer: null })),
    },
    rotation: {
      profile: rotationProfile,
      shifts: Array.from({ length: count }, (_, index) => ({
        index,
        duration_hours: durations[index],
        active_teams: ["alpha"],
        resting_team: "beta",
        scores: {
          trade_score: 0,
          manu_prod_sum: 0,
          power_charge_sum: 0,
          room_lines: [],
        },
        weighted_trade: 0,
        weighted_manu: 0,
        weighted_power: 0,
      })),
      daily: { trade: 1, manufacture: 2, power: 3 },
    },
  };
}

test("v5 persistence stores source, expiry metadata, and strips debug fields", () => {
  const storage = new MemoryStorage();
  const now = Date.parse("2026-07-28T00:00:00.000Z");
  const saved = persistSession(storage, {
    presetLabel: "243",
    layout,
    operbox,
    sourceName: "示例",
    boxSource: "sample",
    layoutDirty: false,
    layoutSource: "local",
    localLayoutBackup: layout,
    rotationProfile: DEFAULT_ROTATION_PROFILE,
    result,
    activeShift: 1,
  }, now);
  assert.equal(Date.parse(saved.expiresAt) - now, SESSION_TTL_MS);
  assert.equal(saved.rotationProfile, DEFAULT_ROTATION_PROFILE);
  assert.equal(saved.result?.debug, undefined);
  assert.deepEqual(saved.result?.trainingAdvice, result.trainingAdvice);
  assert.deepEqual(saved.result?.trainingRoom, result.trainingRoom);
  assert.equal(saved.layoutSource, "local");
  assert.deepEqual(saved.localLayoutBackup, layout);
  assert.deepEqual(loadPersistedSession(storage, now)?.localLayoutBackup, layout);
  assert.equal((JSON.parse(storage.getItem(SESSION_KEY_V5) ?? "{}").result as Record<string, unknown>).debug, undefined);
});

test("local edits preserve a clean baseline beneath a Skland-derived layout", () => {
  const manualLayout = {
    ...layout,
    rooms: [
      ...layout.rooms,
      { id: "factory_1", kind: "factory" as const, level: 2 },
    ],
  };
  const sklandLayout = {
    ...manualLayout,
    rooms: manualLayout.rooms.map((room) => room.id === "factory_1" ? { ...room, level: 3 } : room),
  };
  const edited = applyLocalLayoutPatch({
    layout: sklandLayout,
    layoutSource: "skland",
    localLayoutBackup: manualLayout,
  }, (current) => ({
    ...current,
    rooms: current.rooms.map((room) => room.id === "control" ? { ...room, level: 4 } : room),
  }), layout);

  assert.equal(edited.layoutSource, "skland");
  assert.equal(edited.layout.rooms.find((room) => room.id === "factory_1")?.level, 3);
  assert.equal(edited.localLayoutBackup?.rooms.find((room) => room.id === "factory_1")?.level, 2);
  assert.equal(edited.localLayoutBackup?.rooms.find((room) => room.id === "control")?.level, 4);
});

test("v2 through v4 migrate once to the v5 allowlist", () => {
  for (const legacyKey of [SESSION_KEY_V2, SESSION_KEY_V3, SESSION_KEY_V4]) {
    const storage = new MemoryStorage();
    storage.setItem(legacyKey, JSON.stringify({
      preset: { label: "243" },
      layout,
      operbox,
      fileName: "C:\\private\\box.json",
      boxSource: "maa",
      result: {
        success: true,
        profileJson: result.profile,
        maaJson: result.maa,
        rotationJson: result.rotation,
        runId: "legacy-diag",
        command: "secret",
      },
      activeShift: 2,
    }));
    const migrated = loadPersistedSession(storage, Date.parse("2026-07-28T00:00:00.000Z"));
    assert.equal(migrated?.version, 5);
    assert.equal(migrated?.rotationProfile, DEFAULT_ROTATION_PROFILE);
    assert.equal(migrated?.result?.diagnosticId, "legacy-diag");
    assert.equal(migrated?.result?.debug, undefined);
    assert.equal(storage.getItem(legacyKey), null);
    assert.ok(storage.getItem(SESSION_KEY_V5));
  }
});

test("legacy Skland sessions discard UID-bearing source and plan labels during migration", () => {
  const now = Date.parse("2026-07-28T00:00:00.000Z");
  for (const sessionKey of [SESSION_KEY_V4, SESSION_KEY_V3]) {
    const storage = new MemoryStorage();
    storage.setItem(sessionKey, JSON.stringify({
      version: sessionKey === SESSION_KEY_V4 ? 4 : 3,
      savedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      presetLabel: "243",
      layout,
      operbox,
      sourceName: "skland:123456789:1785196800",
      boxSource: "skland",
      layoutDirty: false,
      result: {
        ...result,
        profile: {
          ...result.profile,
          operbox_label: "skland:123456789:1785196800",
        },
      },
      activeShift: 0,
    }));

    const migrated = loadPersistedSession(storage, now);
    assert.equal(migrated?.sourceName, "森空岛同步");
    assert.equal(migrated?.result, null);
    assert.equal(JSON.stringify([...storage.values.values()]).includes("123456789"), false);
  }
});

test("new Skland persistence always uses a non-identifying source label", () => {
  const storage = new MemoryStorage();
  const saved = persistSession(storage, {
    presetLabel: "243",
    layout,
    operbox,
    sourceName: "skland:123456789:1785196800",
    boxSource: "skland",
    layoutDirty: false,
    layoutSource: "skland",
    rotationProfile: DEFAULT_ROTATION_PROFILE,
    result: {
      ...result,
      profile: {
        ...result.profile,
        operbox_label: "skland:123456789:1785196800",
      },
    },
    activeShift: 0,
  });

  assert.equal(saved.sourceName, "森空岛同步");
  assert.equal(saved.result, null);
  assert.equal(JSON.stringify([...storage.values.values()]).includes("123456789"), false);
});

test("expired and corrupted current sessions are removed", () => {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_KEY_V5, "{bad");
  assert.equal(loadPersistedSession(storage), null);
  assert.equal(storage.getItem(SESSION_KEY_V5), null);

  storage.setItem(SESSION_KEY_V5, JSON.stringify({
    version: 5,
    savedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
    presetLabel: "243",
    layout,
    operbox,
    boxSource: "sample",
    layoutSource: "local",
  }));
  assert.equal(loadPersistedSession(storage, Date.parse("2026-07-28T00:00:00.000Z")), null);
  assert.equal(storage.getItem(SESSION_KEY_V5), null);
});

test("quota failures surface without corrupting the previous session", () => {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_KEY_V5, "previous session");
  storage.failWrites = true;
  assert.throws(() => persistSession(storage, {
    presetLabel: "243",
    layout,
    operbox,
    sourceName: "示例",
    boxSource: "sample",
    layoutDirty: false,
    layoutSource: "local",
    rotationProfile: DEFAULT_ROTATION_PROFILE,
    result: null,
    activeShift: 0,
  }));
  assert.equal(storage.getItem(SESSION_KEY_V5), "previous session");
});

test("failed migration preserves each legacy session for a later retry", () => {
  for (const legacyKey of [SESSION_KEY_V2, SESSION_KEY_V3, SESSION_KEY_V4]) {
    const storage = new MemoryStorage();
    const original = JSON.stringify({ layout, operbox, boxSource: "maa", result: null });
    storage.setItem(legacyKey, original);
    storage.failWrites = true;
    assert.deepEqual(loadPersistedSession(storage)?.operbox, operbox);
    assert.equal(storage.getItem(legacyKey), original);
    assert.equal(storage.getItem(SESSION_KEY_V5), null);
    storage.failWrites = false;
    assert.deepEqual(loadPersistedSession(storage)?.operbox, operbox);
    assert.equal(storage.getItem(legacyKey), null);
    assert.ok(storage.getItem(SESSION_KEY_V5));
  }
});

test("internal fields nested in persisted result data are stripped", () => {
  const storage = new MemoryStorage();
  const unsafeResult = structuredClone(result) as PublicPlanData & {
    profile: PublicPlanData["profile"] & { cliPath?: string };
    trainingAdvice: NonNullable<PublicPlanData["trainingAdvice"]> & { command?: string };
  };
  unsafeResult.profile.cliPath = "C:\\secret\\infra-cli.exe";
  unsafeResult.trainingAdvice.command = "secret";

  const saved = persistSession(storage, {
    presetLabel: "243",
    layout,
    operbox,
    sourceName: "示例",
    boxSource: "sample",
    layoutDirty: false,
    layoutSource: "local",
    rotationProfile: DEFAULT_ROTATION_PROFILE,
    result: unsafeResult,
    activeShift: 0,
  });

  assert.equal("cliPath" in saved.result!.profile, false);
  assert.equal("command" in saved.result!.trainingAdvice!, false);
});

test("persistence preserves MAA protocol candidates only inside rooms", () => {
  const storage = new MemoryStorage();
  const protocolResult = structuredClone(result) as PublicPlanData & {
    maa: PublicPlanData["maa"] & { candidates?: string[] };
  };
  protocolResult.maa.candidates = ["private runtime candidate"];
  protocolResult.maa.plans = [{
    name: "早班",
    description_post: "换班后说明",
    period: [["08:00", "20:00"]],
    duration: 720,
    groups: [{ name: "贸易组", operators: ["龙舌兰"] }],
    drones: { enable: true, room: "trading", index: 1, rule: "all", order: "post" },
    rooms: {
      trading: [{
        operators: ["龙舌兰"],
        candidates: ["但书", "巫恋"],
        use_operator_groups: true,
      }],
      training: [{ operators: ["不应导出的训练室干员"] }],
    },
  } as PublicPlanData["maa"]["plans"][number]];
  protocolResult.trainingRoom = {
    schema_version: 1,
    shifts: [{ trainee: "能天使", trainer: "德克萨斯" }],
  };

  const saved = persistSession(storage, {
    presetLabel: "243",
    layout,
    operbox,
    sourceName: "示例",
    boxSource: "sample",
    layoutDirty: false,
    layoutSource: "local",
    rotationProfile: DEFAULT_ROTATION_PROFILE,
    result: protocolResult,
    activeShift: 0,
  });
  const restored = loadPersistedSession(storage);

  assert.equal("candidates" in saved.result!.maa, false);
  assert.deepEqual(restored?.result?.maa.plans[0].rooms.trading?.[0].candidates, ["但书", "巫恋"]);
  assert.equal(restored?.result?.maa.plans[0].description_post, "换班后说明");
  assert.equal(restored?.result?.maa.plans[0].drones?.rule, "all");
  assert.equal("training" in saved.result!.maa.plans[0]!.rooms, false);
  assert.deepEqual(restored?.result?.trainingRoom, protocolResult.trainingRoom);
});

test("v5 persistence restores the fourth shift when the result has four plans", () => {
  const storage = new MemoryStorage();
  persistSession(storage, {
    presetLabel: "243",
    layout,
    operbox,
    sourceName: "示例",
    boxSource: "sample",
    layoutDirty: false,
    layoutSource: "local",
    rotationProfile: "fiammetta_8_8_4_4",
    result: resultWithShifts(4, "fiammetta_8_8_4_4"),
    activeShift: 3,
  });

  assert.equal(loadPersistedSession(storage)?.activeShift, 3);
});

test("v5 persistence clamps a stale shift index to the available result", () => {
  const storage = new MemoryStorage();
  const saved = persistSession(storage, {
    presetLabel: "243",
    layout,
    operbox,
    sourceName: "示例",
    boxSource: "sample",
    layoutDirty: false,
    layoutSource: "local",
    rotationProfile: "main_backup_12_12",
    result: resultWithShifts(2, "main_backup_12_12"),
    activeShift: 3,
  });

  assert.equal(saved.activeShift, 1);
  assert.equal(loadPersistedSession(storage)?.activeShift, 1);
});

test("old v4 results migrate a missing rotation profile from the saved setting", () => {
  const storage = new MemoryStorage();
  const now = Date.parse("2026-07-28T00:00:00.000Z");
  const legacyResult = JSON.parse(JSON.stringify(resultWithShifts(4))) as Record<string, Record<string, unknown>>;
  delete legacyResult.profile.rotation_profile;
  delete legacyResult.rotation.profile;
  const legacyDaily = legacyResult.rotation.daily as Record<string, unknown>;
  legacyDaily.manu = legacyDaily.manufacture;
  delete legacyDaily.manufacture;
  storage.setItem(SESSION_KEY_V4, JSON.stringify({
    version: 4,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    presetLabel: "243",
    layout,
    operbox,
    sourceName: "示例",
    boxSource: "sample",
    layoutDirty: false,
    rotationProfile: "fiammetta_8_8_4_4",
    result: legacyResult,
    activeShift: 3,
  }));

  const migrated = loadPersistedSession(storage, now);
  assert.equal(migrated?.result?.rotation.profile, "fiammetta_8_8_4_4");
  assert.equal(migrated?.result?.rotation.daily.manufacture, 2);
  assert.equal("manu" in (migrated?.result?.rotation.daily ?? {}), false);
  assert.equal(migrated?.activeShift, 3);
});

test("clear removes all session generations and product preferences", () => {
  const storage = new MemoryStorage();
  [SESSION_KEY_V2, SESSION_KEY_V3, SESSION_KEY_V4, SESSION_KEY_V5, TELEMETRY_SESSION_STORAGE_KEY, "onboarding"].forEach((key) => storage.setItem(key, "1"));
  clearLocalProductData(storage, ["onboarding"]);
  assert.equal(storage.values.size, 0);
});
