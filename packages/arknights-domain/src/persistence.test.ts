import assert from "node:assert/strict";
import test from "node:test";

import type { PublicPlanData, RotationProfile } from "./types.ts";
import { DEFAULT_ROTATION_PROFILE } from "./rotation-settings.ts";
import {
  applyLocalLayoutPatch,
  clearLocalProductData,
  loadPersistedSession,
  persistSession,
  SESSION_KEY,
  SESSION_TTL_MS,
  SESSION_VERSION,
} from "./persistence.ts";
import { TELEMETRY_SESSION_STORAGE_KEY } from "./telemetry-contract.ts";

/** 早期版本把版本号写进了键名；这些键现在只应被清理，不再被读取。 */
const OBSOLETE_SESSION_KEYS = [
  "arknights-infra-calc-session-v6",
  "arknights-infra-calc-session-v5",
  "arknights-infra-calc-session-v4",
  "arknights-infra-calc-beta-session-v3",
  "arknights-infra-calc-beta-session-v2",
];

class MemoryStorage {
  values = new Map<string, string>();
  failWrites = false;

  /** 模拟 localStorage 的可枚举能力，供历史代次键清理使用。 */
  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

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

test("session persistence stores source, expiry metadata, and strips debug fields", () => {
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
  assert.equal((JSON.parse(storage.getItem(SESSION_KEY) ?? "{}").result as Record<string, unknown>).debug, undefined);
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

test("legacy versioned keys are discarded and deleted instead of read", () => {
  for (const legacyKey of OBSOLETE_SESSION_KEYS) {
    const storage = new MemoryStorage();
    storage.setItem(legacyKey, JSON.stringify({
      version: 5,
      preset: { label: "243" },
      layout,
      operbox,
      fileName: "C:\\private\\box.json",
      boxSource: "maa",
      activeShift: 2,
    }));
    assert.equal(loadPersistedSession(storage, Date.parse("2026-07-28T00:00:00.000Z")), null);
    // 旧数据必须被删除，用户只保留一份当前格式的会话，不会永久占用两份存储。
    assert.equal(storage.getItem(legacyKey), null);
    assert.equal(storage.getItem(SESSION_KEY), null);
    assert.equal(storage.values.size, 0);
  }
});

test("sessions with an older schema version are deleted from the stable key", () => {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({
    version: SESSION_VERSION - 1,
    savedAt: "2026-07-28T00:00:00.000Z",
    expiresAt: "2026-08-28T00:00:00.000Z",
    presetLabel: "243",
    layout,
    operbox,
    boxSource: "sample",
    layoutSource: "local",
  }));
  assert.equal(loadPersistedSession(storage, Date.parse("2026-07-28T00:00:00.000Z")), null);
  assert.equal(storage.getItem(SESSION_KEY), null);
});

test("current sessions with a legacy Skland label discard the UID-bearing source and plan labels", () => {
  const now = Date.parse("2026-07-28T00:00:00.000Z");
  const storage = new MemoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({
    version: SESSION_VERSION,
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

  const restored = loadPersistedSession(storage, now);
  assert.equal(restored?.sourceName, "森空岛同步");
  assert.equal(restored?.result, null);
  assert.equal(JSON.stringify([...storage.values.values()]).includes("123456789"), false);
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

test("expired, corrupted and older-schema sessions are removed", () => {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_KEY, "{bad");
  assert.equal(loadPersistedSession(storage), null);
  assert.equal(storage.getItem(SESSION_KEY), null);

  storage.setItem(SESSION_KEY, JSON.stringify({
    version: SESSION_VERSION,
    savedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
    presetLabel: "243",
    layout,
    operbox,
    boxSource: "sample",
    layoutSource: "local",
  }));
  assert.equal(loadPersistedSession(storage, Date.parse("2026-07-28T00:00:00.000Z")), null);
  assert.equal(storage.getItem(SESSION_KEY), null);

  // 结构版本不匹配时必须判废，哪怕其余字段都合法。
  storage.setItem(SESSION_KEY, JSON.stringify({
    version: SESSION_VERSION - 1,
    savedAt: "2026-07-28T00:00:00.000Z",
    expiresAt: "2026-08-28T00:00:00.000Z",
    presetLabel: "243",
    layout,
    operbox,
    boxSource: "sample",
    layoutSource: "local",
  }));
  assert.equal(loadPersistedSession(storage, Date.parse("2026-07-28T00:00:00.000Z")), null);
  assert.equal(storage.getItem(SESSION_KEY), null);
});

test("quota failures surface without corrupting the previous session", () => {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_KEY, "previous session");
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
  assert.equal(storage.getItem(SESSION_KEY), "previous session");
});

test("legacy sessions are cleared even when storage refuses writes", () => {
  for (const legacyKey of OBSOLETE_SESSION_KEYS) {
    const storage = new MemoryStorage();
    storage.setItem(legacyKey, JSON.stringify({ layout, operbox, boxSource: "maa", result: null }));
    storage.failWrites = true;
    // 删除不依赖写入，旧数据必须立刻消失，不能继续占着额度。
    assert.equal(loadPersistedSession(storage), null);
    assert.equal(storage.getItem(legacyKey), null);
    assert.equal(storage.values.size, 0);
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

test("session persistence restores the fourth shift when the result has four plans", () => {
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

test("session persistence clamps a stale shift index to the available result", () => {
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

test("current sessions still normalize a missing rotation profile from the saved setting", () => {
  const storage = new MemoryStorage();
  const now = Date.parse("2026-07-28T00:00:00.000Z");
  const legacyResult = JSON.parse(JSON.stringify(resultWithShifts(4))) as Record<string, Record<string, unknown>>;
  delete legacyResult.profile.rotation_profile;
  delete legacyResult.rotation.profile;
  const legacyDaily = legacyResult.rotation.daily as Record<string, unknown>;
  legacyDaily.manu = legacyDaily.manufacture;
  delete legacyDaily.manufacture;
  storage.setItem(SESSION_KEY, JSON.stringify({
    version: SESSION_VERSION,
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

  const restored = loadPersistedSession(storage, now);
  assert.equal(restored?.result?.rotation.profile, "fiammetta_8_8_4_4");
  assert.equal(restored?.result?.rotation.daily.manufacture, 2);
  assert.equal("manu" in (restored?.result?.rotation.daily ?? {}), false);
  assert.equal(restored?.activeShift, 3);
});

test("clear removes all session generations and product preferences", () => {
  const storage = new MemoryStorage();
  [SESSION_KEY, ...OBSOLETE_SESSION_KEYS, TELEMETRY_SESSION_STORAGE_KEY, "onboarding"].forEach((key) => storage.setItem(key, "1"));
  clearLocalProductData(storage, ["onboarding"]);
  assert.equal(storage.values.size, 0);
});

test("legacy automatic session keys restore with the current default hours", () => {
  const storage = new MemoryStorage();
  persistSession(storage, {
    presetLabel: "243", layout, operbox, sourceName: "示例", boxSource: "sample",
    layoutDirty: false, layoutSource: "local", localLayoutBackup: null,
    rotationProfile: DEFAULT_ROTATION_PROFILE, rotationSelection: "auto_32_32",
    result: null, activeShift: 0,
  });
  assert.equal(loadPersistedSession(storage)?.rotationSelection, "auto_24_24");
  assert.equal(loadPersistedSession(storage)?.result, null);
});


test("historical automatic results retain the exact timing needed for cloud save and reproduction", () => {
  const storage = new MemoryStorage();
  const historical = resultWithShifts(2, "generic_main_backup");
  historical.rotation.shifts.forEach(shift => { shift.duration_hours = 32; });
  historical.rotation.auto_rotation = {
    timing: { shift_hours: [32, 32] }, complete: true, rooms: [], constant_dorm_support: [],
  };
  persistSession(storage, {
    presetLabel: "243", layout, operbox, sourceName: "示例", boxSource: "maa",
    layoutDirty: false, layoutSource: "local", localLayoutBackup: null,
    rotationProfile: "generic_main_backup", rotationSelection: "auto_32_32",
    result: historical, activeShift: 0,
  });
  const restored = loadPersistedSession(storage);
  assert.equal(restored?.rotationSelection, "auto_32_32");
  assert.deepEqual(restored?.result?.rotation.auto_rotation?.timing.shift_hours, [32, 32]);
});
