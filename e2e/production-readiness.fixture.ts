import { expect, type Locator, type Page } from "@playwright/test";
import operatorCatalog from "../src/generated/arkntools/operator-catalog.json" with { type: "json" };

const amiyaPortraitCandidate = operatorCatalog.find((operator) => operator.id === "char_002_amiya")?.portrait;

if (!amiyaPortraitCandidate) throw new Error("Generated operator catalog is missing Amiya's portrait.");
export const amiyaPortrait = amiyaPortraitCandidate;

export const requestId = "11111111-1111-4111-8111-111111111111";

export const diagnosticId = "22222222-2222-4222-8222-222222222222";

export const now = Date.now();

export const layout243 = {
  template: "243",
  drone_cap: 235,
  scenario: {},
  rooms: [
    { id: "workshop", kind: "workshop", level: 3 },
    { id: "training_room", kind: "training_room", level: 3 },
  ],
};

export async function expectUnifiedDialogTypography(dialog: Locator, radius: "24px" | "32px" = "32px") {
  await expect(dialog).toHaveClass(/dialog-surface/);
  await expect(dialog).toHaveCSS("border-radius", radius);
  await expect(dialog.locator('[data-slot="dialog-title"]')).toHaveCSS("font-size", "18px");
  await expect(dialog.locator('[data-slot="dialog-title"]')).toHaveCSS("font-weight", "600");
  await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveCSS("font-size", "13px");
}

export async function expectUnifiedDialogAction(
  button: Locator,
  { width, height }: { width?: "176px" | "196px"; height: "44px" | "46px" }
) {
  if (width) await expect(button).toHaveCSS("width", width);
  await expect(button).toHaveCSS("height", height);
  await expect(button).toHaveCSS("border-radius", "22px");
  await expect(button).toHaveCSS("font-size", "13px");
}

export async function expectButtonGeometryStable(button: Locator) {
  await expect(button).toBeVisible();
  await expect.poll(() => button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      hasSize: rect.width > 1 && rect.height > 1,
      inlineTransform: (element as HTMLElement).style.transform,
      collapsedTransform: style.transform === "matrix(0, 0, 0, 0, 0, 0)",
    };
  })).toEqual({
    hasSize: true,
    inlineTransform: "",
    collapsedTransform: false,
  });
}

export async function armEndingTransitionCapture(element: Locator, label: string) {
  await element.evaluate((node, captureLabel) => {
    const attribute = `data-motion-exit-${captureLabel}`;
    const root = document.documentElement;
    root.removeAttribute(attribute);

    const capture = () => {
      if (!node.hasAttribute("data-ending-style")) return false;
      requestAnimationFrame(() => {
        const durations = node.getAnimations().map((animation) => animation.effect?.getTiming().duration ?? 0);
        root.setAttribute(attribute, JSON.stringify(durations));
      });
      return true;
    };

    if (capture()) return;
    const observer = new MutationObserver(() => {
      if (!capture()) return;
      observer.disconnect();
    });
    observer.observe(node, { attributes: true, attributeFilter: ["data-ending-style"] });
  }, label);
}

export async function expectCapturedExitDuration(page: Page, label: string, durationMs: number) {
  await expect.poll(() => page.locator("html").getAttribute(`data-motion-exit-${label}`)).toContain(String(durationMs));
}

export async function expectMotionDuration(element: Locator, durationMs: number, subtree = false) {
  await expect.poll(() => element.evaluate((node, options) => (
    node.getAnimations({ subtree: options.subtree }).some((animation) => {
      const duration = Number(animation.effect?.getTiming().duration ?? 0);
      return Math.abs(duration - options.durationMs) < 1;
    })
  ), { durationMs, subtree })).toBe(true);
}

export async function armMotionCapture(page: Page, selector: string, label: string, durationMs: number) {
  await page.evaluate(({ selector, label, durationMs }) => {
    const attribute = `data-motion-enter-${label}`;
    const root = document.documentElement;
    const startedAt = performance.now();
    root.removeAttribute(attribute);

    const inspect = () => {
      const timing = Array.from(document.querySelectorAll(selector))
        .flatMap((element) => element.getAnimations())
        .map((animation) => animation.effect?.getTiming())
        .find((candidate) => Math.abs(Number(candidate?.duration ?? 0) - durationMs) < 1);
      if (timing) {
        root.setAttribute(attribute, JSON.stringify({
          duration: Number(timing.duration),
          delay: Number(timing.delay),
        }));
        return;
      }
      if (performance.now() - startedAt < 5_000) requestAnimationFrame(inspect);
    };

    inspect();
  }, { selector, label, durationMs });
}

export async function armMotionCollectionCapture(page: Page, selector: string, label: string, durationMs: number) {
  await page.evaluate(({ selector, label, durationMs }) => {
    const attribute = `data-motion-enter-${label}`;
    const root = document.documentElement;
    const startedAt = performance.now();
    root.removeAttribute(attribute);

    const inspect = () => {
      const elements = Array.from(document.querySelectorAll(selector));
      const timings = elements.map((element) => element.getAnimations()
        .map((animation) => animation.effect?.getTiming())
        .find((candidate) => Math.abs(Number(candidate?.duration ?? 0) - durationMs) < 1));
      if (elements.length > 0 && timings.every(Boolean)) {
        root.setAttribute(attribute, JSON.stringify(timings.map((timing) => ({
          duration: Number(timing?.duration),
          delay: Number(timing?.delay),
        }))));
        return;
      }
      if (performance.now() - startedAt < 5_000) requestAnimationFrame(inspect);
    };

    inspect();
  }, { selector, label, durationMs });
}

export async function expectCapturedMotion(page: Page, label: string, durationMs: number, delayMs = 0) {
  await expect.poll(async () => {
    const value = await page.locator("html").getAttribute(`data-motion-enter-${label}`);
    return value ? JSON.parse(value) as { duration: number; delay: number } : null;
  }).toEqual({ duration: durationMs, delay: delayMs });
}

export async function expectCapturedMotionDelays(page: Page, label: string, durationMs: number, delays: number[]) {
  await expect.poll(async () => {
    const value = await page.locator("html").getAttribute(`data-motion-enter-${label}`);
    if (!value) return null;

    return (JSON.parse(value) as Array<{ duration: number; delay: number }>).map(({ duration, delay }) => ({
      duration: Math.round(duration),
      delay: Math.round(delay),
    }));
  }).toEqual(delays.map((delay) => ({ duration: durationMs, delay })));
}

export async function armTransientStyleCapture(page: Page, selector: string, label: string) {
  await page.evaluate(({ selector, label }) => {
    const attribute = `data-motion-style-${label}`;
    const root = document.documentElement;
    const startedAt = performance.now();
    root.removeAttribute(attribute);

    const inspect = () => {
      for (const element of document.querySelectorAll(selector)) {
        const style = getComputedStyle(element);
        const opacity = Number(style.opacity);
        const transform = style.transform;
        const moved = !["none", "matrix(1, 0, 0, 1, 0, 0)", "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"].includes(transform);
        if (moved || opacity < 0.999) {
          root.setAttribute(attribute, JSON.stringify({ opacity, transform }));
          return;
        }
      }
      if (performance.now() - startedAt < 5_000) requestAnimationFrame(inspect);
    };

    inspect();
  }, { selector, label });
}

export async function expectCapturedStyleMotion(page: Page, label: string) {
  await expect.poll(() => page.locator("html").getAttribute(`data-motion-style-${label}`)).not.toBeNull();
}

export async function waitForOwnAnimations(element: Locator) {
  await element.evaluate(async (node) => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await Promise.race([
      Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  });
}

export async function gotoStable(page: Page, path: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      if (new URL(page.url()).pathname === path) return;
    } catch (error) {
      lastError = error;
      if (!/interrupted by another navigation|Load failed/i.test(String(error))) throw error;
    }
    await page.waitForTimeout(250);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Unable to navigate to ${path} after a development reload.`);
}

export async function expectVisibleNumbersUseNumberFont(page: Page, scope: Locator = page.locator("body")) {
  await page.evaluate(async () => {
    const numberFamily = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-number-source")
      .split(",")[0]
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (numberFamily) {
      await document.fonts.load(`16px "${numberFamily}"`, "0123456789+-.,%/:−");
    }
    await document.fonts.ready;
  });
  const audit = await scope.evaluate((root) => {
    const numberFamily = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-number-source")
      .split(",")[0]
      .trim()
      .replace(/^['"]|['"]$/g, "");
    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
    const failures: Array<{ tag: string; text: string; fontFamily: string }> = [];

    for (const element of elements) {
      if (element.closest("svg, [aria-hidden='true'], [data-ui-number-font]")) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) continue;

      const directText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join(" ");
      const controlValue = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.value
        : "";
      const numericText = `${directText} ${controlValue}`.replace(/\s+/g, " ").trim();
      if (!/\d/.test(numericText) || style.fontFamily.includes(numberFamily)) continue;

      failures.push({
        tag: element.tagName.toLowerCase(),
        text: numericText.slice(0, 100),
        fontFamily: style.fontFamily,
      });
    }

    return {
      failures,
      loaded: Boolean(numberFamily) && document.fonts.check(`16px "${numberFamily}"`, "0123456789+-.,%/:−"),
      numberFamily,
    };
  });

  expect(audit.numberFamily).toBeTruthy();
  expect(audit.loaded).toBe(true);
  expect(audit.failures, JSON.stringify(audit.failures, null, 2)).toEqual([]);
}

export const profile = {
  schema_version: 4,
  rotation_profile: "abc_12_6_6",
  layout_label: "243",
  operbox_label: "243 全精二示例",
  baseline_label: "产品推荐基准",
  summary: { owned: 1, tier_up_owned: 1, trade_pool_ready: 1, manufacture_pool_ready: 1 },
  domains: [],
  rotation: {},
  baseline_rotation: {},
  actions: [],
  flags: [],
  narration_hints: [],
};

export function maaPlan(index: number) {
  return {
    name: `班次 ${index + 1}`,
    description: `固定测试班次 ${index + 1}`,
    rooms: {
      processing: [{ operators: ["阿米娅"] }],
    },
  };
}

export const planData = {
  profile,
  maa: {
    title: "明日方舟基建排班助手 · 243",
    plans: [maaPlan(0), maaPlan(1), maaPlan(2)],
  },
  rotation: {
    profile: "abc_12_6_6",
    shifts: [0, 1, 2].map((index) => ({
      index,
      duration_hours: index === 0 ? 12 : 6,
      active_teams: ["A"],
      resting_team: "B",
      scores: { trade_score: 0, manu_prod_sum: 0, power_charge_sum: 0, room_lines: [] },
      weighted_trade: 0,
      weighted_manu: 0,
      weighted_power: 0,
    })),
    daily: {
      trade: 0,
      manufacture: 0,
      power: 0,
      production: { lmd: 34_254, pure_gold: 53_000, battle_records: 22_400, originium_shards: 48, orundum: 360 },
    },
  },
  durationMs: 42,
  diagnosticId,
};

export function rotationResultData({
  rotationProfile,
  durations,
  profileOverrides = {},
}: {
  rotationProfile: "abc_12_6_6" | "main_backup_12_12" | "fiammetta_8_8_4_4" | "abyssal_7_5_7_5";
  durations: number[];
  profileOverrides?: Record<string, unknown>;
}) {
  return {
    ...planData,
    profile: {
      ...profile,
      rotation_profile: rotationProfile,
      ...profileOverrides,
    },
    maa: {
      ...planData.maa,
      plans: durations.map((_, index) => maaPlan(index)),
    },
    rotation: {
      profile: rotationProfile,
      shifts: durations.map((duration, index) => ({
        index,
        duration_hours: duration,
        active_teams: index % 2 === 0 ? ["alpha"] : ["beta"],
        resting_team: index % 2 === 0 ? "beta" : "alpha",
        scores: { trade_score: 0, manu_prod_sum: 0, power_charge_sum: 0, room_lines: [] },
        weighted_trade: 0,
        weighted_manu: 0,
        weighted_power: 0,
      })),
      daily: { trade: 5.288, manufacture: 9.175, power: 3.552 },
    },
  };
}

export const twoShiftPlanBase = rotationResultData({
  rotationProfile: "main_backup_12_12",
  durations: [12, 12],
  profileOverrides: {
    rotation: {
      daily_trade_efficiency: 5.288,
      daily_manufacture_efficiency: 9.175,
      daily_power_efficiency: 3.552,
    },
    baseline_rotation: {
      daily_trade_efficiency: 4.968,
      daily_manufacture_efficiency: 8.5,
      daily_power_efficiency: 3.2,
    },
    domains: [{
      id: "manufacture",
      label: "制造站",
      current: {
        operators: ["阿米娅"],
        final_efficiency: 1.55,
        mechanic_equivalent_efficiency: 1.42,
      },
      baseline: {
        operators: ["基准组合"],
        final_efficiency: 1.4,
        mechanic_equivalent_efficiency: 1.31,
      },
      gap_ratio: 0.107,
      severity: "ok",
    }],
    actions: [{
      priority: "中",
      kind: "promote_tier_up",
      operator: "阿米娅",
      domain_id: "manufacture",
      message: "提升精英阶段以补齐制造轮换。",
      current_elite: 1,
      tier_up_requirement: "精2",
    }],
  },
});

export const twoShiftPlanData = {
  ...twoShiftPlanBase,
  maa: {
    ...twoShiftPlanBase.maa,
    plans: twoShiftPlanBase.maa.plans.map((plan, index) => ({
      ...plan,
      drones: { enable: true, room: "manufacture" as const, index: index === 0 ? 1 : 3, order: "pre" as const },
      rooms: {
        ...plan.rooms,
        trading: [
          { product: "LMD", operators: [], sort: true, autofill: false },
          { product: "Originium Shard", operators: [], sort: true, autofill: false },
        ],
        manufacture: [
          { product: "Gold", operators: [], sort: true, autofill: false },
          { product: "Gold", operators: [], sort: true, autofill: false },
          { product: "Battle Record", operators: [], sort: true, autofill: false },
          { product: "Originium Shard", operators: [], sort: true, autofill: false },
        ],
        power: [0, 1, 2].map(() => ({ operators: [] })),
      },
    })),
  },
  rotation: {
    ...twoShiftPlanBase.rotation,
    daily: {
      ...twoShiftPlanBase.rotation.daily,
      production: { lmd: 34_254, pure_gold: 53_000, battle_records: 22_400, originium_shards: 48, orundum: 360 },
    },
    shifts: twoShiftPlanBase.rotation.shifts.map((shift) => ({
      ...shift,
      scores: {
        ...shift.scores,
        room_lines: [
          { room_id: "trade_1", final_efficiency: 3.337, trade_score: 3.337, trade_pct: 135, trade_skill_pct: 132, trade_gold_pct: 42 },
          { room_id: "trade_2", final_efficiency: 1.5, trade_score: 1.5, trade_pct: 50, trade_skill_pct: 50 },
          { room_id: "manu_1", final_efficiency: 2.36, manu_score: 236, manu_prod_skill: 130, manu_display_pct: 136 },
          { room_id: "manu_2", final_efficiency: 2, manu_prod_total: 100, manu_prod_skill: 94 },
          { room_id: "manu_3", final_efficiency: 2, manu_prod_total: 100, manu_prod_skill: 94 },
          { room_id: "manu_4", final_efficiency: 2, manu_prod_total: 100, manu_prod_skill: 94 },
          { room_id: "power_1", final_efficiency: 1.2, power_charge_speed_pct: 20 },
          { room_id: "power_2", final_efficiency: 1.2, power_charge_speed_pct: 20 },
          { room_id: "power_3", final_efficiency: 1.2, power_charge_speed_pct: 20 },
        ],
      },
    })),
  },
};

export const fourShiftPlanData = rotationResultData({
  rotationProfile: "fiammetta_8_8_4_4",
  durations: [8, 8, 4, 4],
});

export const scheduleVisualPlanData = {
  ...planData,
  maa: {
    ...planData.maa,
    plans: [0, 1, 2].map((index) => ({
      ...maaPlan(index),
      rooms: {
        trading: [{
          product: "LMD",
          operators: [{ name: "阿米娅", skill: 1 }, { name: "凯尔希", skill: 99 }, "贝洛内"],
          sort: true,
          autofill: false,
        }],
        processing: [{ operators: [{ name: "阿米娅", skill: 2 }] }],
      },
    })),
  },
};

export const adjacentPortraitOperators = ["阿米娅", "凯尔希", "贝洛内"] as const;

export const adjacentPortraitPlanData = {
  ...scheduleVisualPlanData,
  maa: {
    ...scheduleVisualPlanData.maa,
    plans: scheduleVisualPlanData.maa.plans.map((plan, index) => ({
      ...plan,
      rooms: {
        trading: [{
          product: "LMD",
          operators: [adjacentPortraitOperators[index] ?? adjacentPortraitOperators[0]],
          sort: true,
          autofill: false,
        }],
      },
    })),
  },
};

export const lazyPortraitPlanData = {
  ...scheduleVisualPlanData,
  maa: {
    ...scheduleVisualPlanData.maa,
    plans: scheduleVisualPlanData.maa.plans.map((plan) => ({
      ...plan,
      rooms: {
        ...plan.rooms,
        processing: [{ operators: [{ name: "嘉辛塔", skill: 1 }] }],
      },
    })),
  },
};

export const productChangePlanData = {
  ...scheduleVisualPlanData,
  maa: {
    ...scheduleVisualPlanData.maa,
    plans: scheduleVisualPlanData.maa.plans.map((plan) => ({
      ...plan,
      rooms: {
        ...plan.rooms,
        trading: [0, 1].map(() => ({ product: "LMD", operators: [], sort: true, autofill: false })),
        manufacture: [0, 1, 2, 3].map(() => ({ product: "Gold", operators: [], sort: true, autofill: false })),
      },
    })),
  },
};

export const motionPlanBase = rotationResultData({
  rotationProfile: "abc_12_6_6",
  durations: [12, 6, 6],
});

export const motionPlanData = {
  ...motionPlanBase,
  trainingRoom: {
    schema_version: 1 as const,
    shifts: [
      { trainee: "Training-A", trainer: "Trainer-A" },
      { trainee: "Training-B", trainer: null },
      { trainee: null, trainer: "Trainer-C" },
    ],
  },
  maa: {
    ...motionPlanBase.maa,
    plans: [0, 1, 2].map((index) => ({
      ...maaPlan(index),
      rooms: {
        control: [{ operators: [] }],
        trading: [0, 1].map((roomIndex) => ({
          product: "LMD",
          operators: roomIndex === 0 ? [{ name: ["阿米娅", "凯尔希", "贝洛内"][index], skill: 2 }] : [],
          sort: true,
          autofill: false,
        })),
        manufacture: [0, 1, 2, 3].map(() => ({ product: "Gold", operators: [], sort: true, autofill: false })),
        power: [0, 1, 2].map(() => ({ operators: [] })),
        dormitory: [0, 1, 2, 3].map(() => ({ operators: [], autofill: true })),
        meeting: [{ operators: [] }],
        hire: [{ operators: [] }],
        processing: [{ operators: [{ name: ["阿米娅", "凯尔希", "贝洛内"][index], skill: 2 }] }],
      },
    })),
  },
};

export const sampleData = [{
  id: "char_002_amiya",
  name: "阿米娅",
  elite: 2,
  level: 80,
  own: true,
  potential: 6,
  rarity: 5,
}];

export const authenticatedSklandSnapshot = {
  player: {
    uid: "123456789",
    nickname: "测试博士",
    level: 120,
    channelName: "官服",
    avatarUrl: null,
    registerTs: 1_600_000_000,
    mainStageProgress: "14-21",
    resume: "为了更好的明天。",
    subscriptionEnd: 1_800_000_000,
    storeTs: 1_700_000_090,
    lastOnlineTs: 1_700_000_080,
    sanity: { current: 120, max: 135, completeRecoveryTime: 1_700_010_000 },
    secretary: { id: "char_002_amiya", name: "阿米娅", skinName: "见习联结者" },
    counts: { operators: 2, furniture: 200, skins: 1 },
  },
  roles: [
    { uid: "123456789", nickname: "测试博士", channelName: "官服", isDefault: true },
    { uid: "987654321", nickname: "测试博士二号", channelName: "B服", isDefault: false },
  ],
  operbox: [
    { id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 6, rarity: 5 },
    { id: "char_003_kalts", name: "凯尔希", elite: 2, level: 90, own: true, potential: 1, rarity: 6 },
  ],
  infrastructure: {
    currentTs: 1_700_000_100,
    storeTs: 1_700_000_090,
    layoutLabel: "243",
    layoutSuggestion: layout243,
    layoutWarning: null,
    tiredOperators: ["阿米娅"],
    labor: { value: 235, maxValue: 235, remainSecs: 0, lastUpdateTime: 1_700_000_000 },
    furnitureTotal: 200,
    training: {
      trainee: "凯尔希",
      trainer: "阿米娅",
      skillIndex: 2,
      remainSecs: 3_600,
      remainPoint: 100,
      speed: 1.2,
      completeWorkTime: 1_700_003_700,
    },
    rooms: [
      {
        key: "control",
        group: "control",
        index: 0,
        level: 5,
        operators: [{ id: "char_002_amiya", name: "阿米娅", morale: 18, workTime: 7_200, lastMoraleUpdateTs: 1_700_000_050 }],
      },
      {
        key: "trade-0",
        group: "trading",
        index: 0,
        level: 3,
        product: "gold",
        operators: [],
        production: { stock: 10, capacity: 10, unitCapacity: null, completed: null, remaining: null, completeWorkTime: 1_700_001_200 },
        orders: [{ delivery: [{ type: "material", count: 3 }], reward: { type: "lmd", count: 1_500 } }],
        lastUpdateTime: 1_700_000_000,
      },
      {
        key: "factory-0",
        group: "manufacture",
        index: 0,
        level: 3,
        product: "battle_record",
        operators: [],
        production: { stock: 2, capacity: 10, unitCapacity: 78, completed: 2, remaining: 8, completeWorkTime: 1_700_001_000 },
        speed: 1.5,
        lastUpdateTime: 1_700_000_000,
      },
      {
        key: "dorm-0",
        group: "dormitory",
        index: 0,
        level: 5,
        operators: [
          { id: "char_003_kalts", name: "凯尔希", morale: 24, workTime: 0, lastMoraleUpdateTs: 1_700_000_050 },
          { id: "char_002_amiya", name: "阿米娅", morale: 18, workTime: 0, lastMoraleUpdateTs: 1_700_000_050 },
        ],
        comfort: 5_000,
      },
      {
        key: "meeting",
        group: "meeting",
        index: 0,
        level: 3,
        operators: [],
        clue: {
          board: ["莱茵生命", "罗德岛"],
          own: 4,
          received: 1,
          dailyReward: true,
          needReceive: 2,
          sharing: true,
          shareCompleteTime: 1_700_005_000,
        },
        completeWorkTime: 1_700_003_000,
        lastUpdateTime: 1_700_000_000,
      },
      {
        key: "hire",
        group: "hire",
        index: 0,
        level: 3,
        operators: [],
        refreshCount: 2,
        completeWorkTime: 1_700_002_000,
      },
      {
        key: "training-1",
        group: "training",
        index: 0,
        level: 3,
        operators: [
          { id: "char_003_kalts", name: "凯尔希", morale: 24, lastMoraleUpdateTs: 1_700_000_050, position: "trainee" },
          { id: "char_002_amiya", name: "阿米娅", morale: 18, lastMoraleUpdateTs: 1_700_000_050, position: "trainer" },
        ],
        occupancy: { current: 2, capacity: 2 },
      },
      {
        key: "workshop",
        group: "processing",
        index: 0,
        level: 3,
        operators: [],
      },
    ],
  },
  operators: [
    {
      id: "char_003_kalts",
      name: "凯尔希",
      rarity: 6,
      profession: "MEDIC",
      subProfessionName: "医师",
      elite: 2,
      level: 90,
      potential: 1,
      favorPercent: 200,
      mainSkillLevel: 7,
      skills: [{ index: 1, specializeLevel: 3 }, { index: 2, specializeLevel: 1 }],
      modules: [{ id: "uniequip_1", name: "医者意志", level: 3, locked: false, isDefault: true }],
      currentSkinName: "残余",
      acquiredAt: 1_650_000_000,
      isAssist: true,
    },
    {
      id: "char_002_amiya",
      name: "阿米娅",
      rarity: 5,
      profession: "CASTER",
      subProfessionName: "中坚术师",
      elite: 2,
      level: 80,
      potential: 6,
      favorPercent: 200,
      mainSkillLevel: 7,
      skills: [{ index: 1, specializeLevel: 3 }],
      modules: [],
      currentSkinName: "见习联结者",
      acquiredAt: 1_600_000_000,
      isAssist: false,
    },
  ],
  skins: [{
    id: "skin_amiya",
    name: "见习联结者",
    brandId: "EPOQUE",
    operatorId: "char_002_amiya",
    operatorName: "阿米娅",
    obtainedAt: 1_660_000_000,
    isCurrent: true,
  }],
  progress: {
    recruit: [{ index: 0, startTs: 1_699_990_000, finishTs: 1_700_000_050, state: "completed" }],
    routine: { daily: { current: 8, total: 10 }, weekly: { current: 80, total: 100 } },
    campaign: {
      records: [{ name: "切尔诺伯格", zoneName: "乌萨斯", maxKills: 400 }],
      reward: { current: 1_800, total: 1_800 },
    },
    tower: {
      records: [{ name: "钢铁萝卜矿场", subName: "测试周期", best: 8 }],
      reward: {
        higher: { current: 1, total: 2 },
        lower: { current: 3, total: 4 },
        termTs: 1_800_000_000,
      },
    },
    rogue: [{ name: "傀影与猩红孤钻", relicCount: 120, bankCurrent: 300, bankRecord: 500 }],
    activities: [{
      name: "测试活动",
      startTime: 1_700_000_000,
      endTime: 1_800_000_000,
      rewardEndTime: 1_800_100_000,
      isReplicate: false,
      clearedStages: 8,
      totalStages: 10,
    }],
    bossRush: [{ played: true, stageCode: "TN-1", stageName: "测试关卡", difficulty: "NORMAL" }],
  },
  sourceName: "森空岛同步",
  warnings: [],
};

export function mockInfrastructureOperators(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    name: `${prefix}-${index + 1}`,
    morale: 24 - index,
    workTime: 7_200 + index * 300,
    lastMoraleUpdateTs: 1_700_000_050,
  }));
}

export const productionHeavySklandSnapshot = {
  ...authenticatedSklandSnapshot,
  infrastructure: {
    ...authenticatedSklandSnapshot.infrastructure,
    rooms: [
      {
        ...authenticatedSklandSnapshot.infrastructure.rooms[0],
        operators: mockInfrastructureOperators("control", 5),
      },
      ...Array.from({ length: 2 }, (_, index) => ({
        ...authenticatedSklandSnapshot.infrastructure.rooms[1],
        key: `trade-${index}`,
        index,
        operators: mockInfrastructureOperators(`trade-${index}`, 3),
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        ...authenticatedSklandSnapshot.infrastructure.rooms[2],
        key: `factory-${index}`,
        index,
        operators: mockInfrastructureOperators(`factory-${index}`, 3),
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        key: `power-${index}`,
        group: "power",
        index,
        level: 3,
        operators: mockInfrastructureOperators(`power-${index}`, 1),
      })),
      authenticatedSklandSnapshot.infrastructure.rooms[4],
      authenticatedSklandSnapshot.infrastructure.rooms[5],
      authenticatedSklandSnapshot.infrastructure.rooms[6],
      ...Array.from({ length: 4 }, (_, index) => ({
        ...authenticatedSklandSnapshot.infrastructure.rooms[3],
        key: `dorm-${index}`,
        index,
        operators: mockInfrastructureOperators(`dorm-${index}`, 5),
      })),
    ],
  },
};

export const primarySklandAccount = {
  accountId: "account_primary",
  selectedUid: authenticatedSklandSnapshot.player.uid,
  roles: authenticatedSklandSnapshot.roles,
  credentialExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
};

export type MockSklandSnapshot = Omit<typeof authenticatedSklandSnapshot, "infrastructure" | "player"> & {
  player: Omit<typeof authenticatedSklandSnapshot.player, "avatarUrl"> & {
    avatarUrl: string | null;
  };
  infrastructure: Omit<typeof authenticatedSklandSnapshot.infrastructure, "layoutSuggestion"> & {
    layoutSuggestion: typeof layout243 | null;
  };
};

export async function mockApis(
  page: Page,
  options: {
    debugTools?: boolean;
    sklandConfigured?: boolean;
    sklandSnapshot?: MockSklandSnapshot;
    sklandAccounts?: typeof primarySklandAccount[];
    activeAccountId?: string | null;
    sklandBindingCount?: number;
    sklandRenewalDueCount?: number;
    sklandSessionDelayMs?: number;
    sklandSummaryDelayMs?: number;
    sklandSessionFailure?: boolean;
    plannerReady?: boolean;
    taskQueueEnabled?: boolean;
    telemetryBatches?: Array<Array<Record<string, unknown>>>;
    dismissSolverWarning?: boolean;
  } = {}
) {
  // UI fixtures use the explicit public rollout in playwright.config.ts.
  await page.route("**/api/account/feature-access", (route) => route.fulfill({ json: { agent: true, billing: true } }));
  if (options.dismissSolverWarning !== false) {
    // Result tests continue after acknowledging the new solver notice.
    // Its own coverage opts out and verifies the full dialog interaction.
    await page.addLocatorHandler(page.getByRole("dialog", { name: /^(排班已生成|Schedule generated)$/ }), async (dialog) => {
      await dialog.getByRole("button", { name: /^(关闭|Dismiss)$/ }).click();
    });
  }
  // Existing feature tests are independent of database-backed release announcements.
  await page.route("**/api/releases*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data: { environment: "local", releases: [] }, requestId }),
  }));
  await page.route("**/api/readiness", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "X-Request-Id": requestId },
    body: JSON.stringify({
      success: true,
      data: {
        status: "ready",
        plannerReady: options.plannerReady ?? true,
        taskQueue: {
          enabled: Boolean(options.taskQueueEnabled),
          ready: Boolean(options.taskQueueEnabled),
          releaseMatched: Boolean(options.taskQueueEnabled),
        },
        skland: {
          available: Boolean(options.sklandConfigured),
          message: options.sklandConfigured ? null : "当前未开放森空岛登录，可使用 MAA 导入。",
        },
        features: { debugTools: Boolean(options.debugTools), rateLimit: false },
      },
      requestId,
    }),
  }));
  await page.route(/\/api\/skland\/accounts(?:[/?]|$)/, async (route) => {
    const mode = new URL(route.request().url()).searchParams.get("mode");
    const isSummary = mode === "summary";
    const isLogout = route.request().method() === "DELETE";
    if (isSummary && options.sklandSummaryDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.sklandSummaryDelayMs));
    } else if (!isSummary && !isLogout && options.sklandSessionDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.sklandSessionDelayMs));
    }
    if (!isSummary && !isLogout && options.sklandSessionFailure) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        headers: { "X-Request-Id": requestId },
        body: JSON.stringify({
          success: false,
          error: { code: "AIC-SYS-5000", message: "森空岛会话恢复失败，请稍后刷新。", retryable: true },
          requestId,
        }),
      });
    }
    const accounts = options.sklandAccounts
      ?? (options.sklandSnapshot ? [{
        ...primarySklandAccount,
        selectedUid: options.sklandSnapshot.player.uid,
        roles: options.sklandSnapshot.roles,
      }] : []);
    const activeAccountId = options.activeAccountId
      ?? (accounts.length ? accounts[0].accountId : null);
    const bindingCount = options.sklandBindingCount ?? accounts.length;
    const renewalDueCount = Math.min(bindingCount, options.sklandRenewalDueCount ?? 0);
    const activeBindingCount = bindingCount - renewalDueCount;
    const bindingSummary = {
      totalCount: bindingCount,
      activeCount: activeBindingCount,
      renewalDueCount,
      nextExpiresAt: activeBindingCount > 0 ? Date.now() + 7 * 24 * 60 * 60 * 1000 : null,
      latestExpiredAt: renewalDueCount > 0 ? Date.now() - 60_000 : null,
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Request-Id": requestId },
      body: JSON.stringify({
        success: true,
        data: isLogout
          ? {
              authenticated: false,
              configured: Boolean(options.sklandConfigured),
              authMethods: { qr: true, credential: true },
              accounts: [],
              activeAccountId: null,
              bindingCount: 0,
              bindingSummary: { totalCount: 0, activeCount: 0, renewalDueCount: 0, nextExpiresAt: null, latestExpiredAt: null },
            }
          : {
              authenticated: isSummary ? accounts.length > 0 : Boolean(options.sklandSnapshot),
              configured: Boolean(options.sklandConfigured),
              authMethods: { qr: true, credential: true },
              accounts,
              activeAccountId,
              bindingCount,
              bindingSummary,
              disabledReason: options.sklandConfigured
                ? null
                : "当前未开放森空岛登录，可使用 MAA 导入。",
              ...(!isSummary && options.sklandSnapshot ? { scheduleSnapshot: options.sklandSnapshot } : {}),
              ...(!isSummary && options.sklandSnapshot ? { statusSnapshot: options.sklandSnapshot } : {}),
            },
        requestId,
      }),
    });
  });
  await page.route("**/api/skland/status/refresh", (route) => {
    const accounts = (options.sklandAccounts
      ?? (options.sklandSnapshot ? [primarySklandAccount] : []));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Request-Id": requestId },
      body: JSON.stringify({
        success: true,
        data: {
          accounts,
          activeAccountId: options.activeAccountId ?? accounts[0]?.accountId ?? null,
          ...(options.sklandSnapshot ? { snapshot: options.sklandSnapshot } : {}),
        },
        requestId,
      }),
    });
  });
  await page.route("**/api/skland/account-data", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "X-Request-Id": requestId },
    body: JSON.stringify({ success: true, data: { deleted: true, runs: 1, feedback: 0 }, requestId }),
  }));
  await page.route("**/api/sample-operbox", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: { sourceName: "243 全精二示例", operbox: sampleData },
      requestId,
    }),
  }));
  await page.route("**/api/plan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: options.debugTools
        ? {
            ...planData,
            debug: {
              command: "infra-cli serve",
              stdout: "test output",
              stderr: "",
              debugBundle: { version: "test" },
            },
          }
        : planData,
      requestId,
    }),
  }));
  await page.route("**/api/feedback", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: { feedbackId: "feedback-001", savedAt: "2026-07-28T00:00:00.000Z" },
      requestId,
    }),
  }));
  await page.route("**/api/telemetry", async (route) => {
    const body = route.request().postDataJSON() as { events?: Array<Record<string, unknown>> } | null;
    const events = Array.isArray(body?.events) ? body.events : [];
    options.telemetryBatches?.push(events);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Request-Id": requestId },
      body: JSON.stringify({ success: true, data: { accepted: events.length }, requestId }),
    });
  });
}

export async function openSklandOverview(page: Page) {
  await page.getByRole("button", { name: "森空岛状态中心", exact: true }).click();
  await expect(page.locator("[data-skland-page]")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
}

export async function mockAnonymousWebsiteSession(page: Page) {
  await page.unroute("**/api/auth/get-session");
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "null",
  }));
}

export async function navigateToPrimaryPage(
  page: Page,
  destination: { name: string; href: string; root: string },
  mobile: boolean,
) {
  if (mobile) {
    await page.locator("[data-app-topbar]").getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
  }
  await page.getByRole("button", { name: destination.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${destination.href.replace("/", "\\/")}$`));
  await expect(page.locator(destination.root)).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
  if (mobile) {
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toHaveCount(0);
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  }
}

export async function seedPreferences(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
  });
}

export async function seedV4Session(
  page: Page,
  seededResult: unknown = planData,
  options: {
    activeShift?: number;
    rotationProfile?: string;
    layoutDirty?: boolean;
    operbox?: Array<Record<string, unknown>>;
    boxSource?: "sample" | "maa" | "skland";
    onboardingValue?: string | null;
  } = {}
) {
  await page.addInitScript(({ layout, result, savedAt, expiresAt, activeShift, rotationProfile, layoutDirty, operbox, boxSource, onboardingValue }) => {
    if (onboardingValue !== null) window.localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", onboardingValue);
    if (!window.localStorage.getItem("arknights-infra-calc-session-v4")) window.localStorage.setItem("arknights-infra-calc-session-v4", JSON.stringify({
      version: 4,
      savedAt,
      expiresAt,
      presetLabel: "243",
      layout,
      operbox: operbox ?? [{
        id: "char_002_amiya",
        name: "阿米娅",
        elite: 2,
        level: 80,
        own: true,
        potential: 6,
        rarity: 5,
      }],
      sourceName: "243 全精二示例",
      boxSource,
      layoutDirty,
      rotationProfile,
      result,
      activeShift,
    }));
  }, {
    layout: layout243,
    result: seededResult,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
    activeShift: options.activeShift ?? 0,
    rotationProfile: options.rotationProfile ?? "abc_12_6_6",
    layoutDirty: options.layoutDirty ?? false,
    operbox: options.operbox,
    boxSource: options.boxSource ?? "sample",
    onboardingValue: options.onboardingValue === undefined ? "1" : options.onboardingValue,
  });
}
