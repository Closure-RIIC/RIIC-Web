import { expect, test, type Page } from "@playwright/test";
import layout from "@riic/arknights-domain/layouts/243.json" with { type: "json" };
import { mockApis, mockSignedInWebsiteSession } from "./production-readiness.fixture";

declare global {
  interface Window {
    moodWorkerTest: { count: number; hold: boolean; failNext: boolean; held: Array<() => void> };
  }
}

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await mockSignedInWebsiteSession(page);
  await page.addInitScript(({ layout }) => {
    const control = window.moodWorkerTest = { count: 0, hold: false, failNext: false, held: [] as Array<() => void> };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => {
          if (event.data.type !== "result" || !control.hold) return;
          event.stopImmediatePropagation();
          const receive = this.onmessage;
          // Preserve the old callback to exercise replies arriving after worker disposal.
          control.held.push(() => receive?.call(this, event));
        });
      }
      postMessage(message: { type: string; id: number }, transfer?: Transferable[] | StructuredSerializeOptions) {
        if (message.type === "simulate") {
          control.count++;
          if (control.failNext) {
            control.failNext = false;
            queueMicrotask(() => this.onmessage?.call(this, new MessageEvent("message", {
              data: { type: "error", id: message.id, message: "Injected simulation failure" },
            })));
            return;
          }
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
    if (localStorage.getItem("mood-sync-seeded")) return;
    localStorage.setItem("mood-sync-seeded", "1");
    localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
    const operbox = [
      { id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 1, rarity: 5 },
      { id: "char_300_phenxi", name: "菲亚梅塔", elite: 2, level: 60, own: true, potential: 1, rarity: 6 },
      { id: "char_348_ceylon", name: "锡兰", elite: 2, level: 60, own: true, potential: 1, rarity: 5 },
    ];
    localStorage.setItem("arknights-infra-calc-session-v5", JSON.stringify({
      version: 5, savedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
      presetLabel: "243", layout, operbox, sourceName: "Mood sync test", boxSource: "sample", layoutDirty: false,
      layoutSource: "local", localLayoutBackup: null, rotationProfile: "abc_12_6_6", fiammettaEnabled: true, result: null, activeShift: 0,
    }));
    localStorage.setItem("arknights-infra-manual-schedule-v1", JSON.stringify({
      version: 3, scheduleMode: "sequential", externalOperatorNames: [], startTime: "08:00", activeShift: 2, fiammettaEnabled: true,
      shifts: ["trade_1", "manu_1", "trade_2"].map((room, index) => ({
        durationHours: 8, fiammettaTarget: index === 1 ? "锡兰" : "阿米娅", droneTargetRoomId: room,
        rooms: { trade_1: { operators: ["阿米娅"] } },
      })),
    }));
  }, { layout });
});

const panel = (page: Page) => page.locator("[data-mood-simulation]");
const board = (page: Page) => page.locator("[data-manual-editor-board]:visible");
const timeline = (page: Page) => panel(page).getByLabel("模拟时间轴");
const play = (page: Page) => panel(page).getByRole("button", { name: "开始播放", exact: true });
const edit = (page: Page) => panel(page).getByRole("tab", { name: "排班编辑", exact: true }).click();
const replay = (page: Page) => panel(page).getByRole("tab", { name: "心情回放", exact: true }).click();
const shift = (page: Page, index: number) => board(page).locator("[data-shift-tabs]").getByRole("tab").nth(index).click();
const requests = (page: Page) => page.evaluate(() => window.moodWorkerTest.count);
const savedDraft = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-manual-schedule-v1")!));
async function choose(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}

for (const width of [1440, 390]) {
  test(`manual morale synchronizes selected shifts, support and navigation at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/manual");
    await expect(play(page)).toBeEnabled({ timeout: 60_000 });
    const before = await savedDraft(page);
    const workerCount = await requests(page);
    await replay(page);
    await expect(timeline(page)).toHaveValue("16");
    await expect(board(page)).toContainText("第 1 周期 · 第 3 班");
    await expect(page.locator('[data-plan-support="drones"]')).toContainText("贸易站 2");
    await expect(page.locator('[data-plan-support="drones"] button')).toHaveCount(0);

    await edit(page);
    await shift(page, 1);
    await replay(page);
    await expect(timeline(page)).toHaveValue("8");
    await expect(page.locator('[data-plan-support="morale"]')).toContainText("锡兰");
    await expect(page.locator('[data-plan-support="drones"]')).toContainText("制造站 1");
    await panel(page).getByRole("group", { name: "选择干员查看心情" }).getByRole("button", { name: /阿米娅/ }).click();
    await expect(panel(page).locator('[data-mood-detail] h3')).toContainText("16 / 24");
    await timeline(page).press("ArrowRight");
    await expect(timeline(page)).toHaveValue("8.25");
    await edit(page);
    await replay(page);
    await expect(timeline(page)).toHaveValue("8.25");
    await timeline(page).press("End");
    await expect(board(page)).toContainText("第 1 周期 · 第 3 班");
    await expect(page.locator('[data-plan-support="drones"]')).toContainText("贸易站 2");
    await edit(page);
    await replay(page);
    await expect(timeline(page)).toHaveValue("8");
    await panel(page).getByRole("button", { name: "回到起点", exact: true }).click();
    await expect(timeline(page)).toHaveValue("0");
    await expect(page.locator('[data-plan-support="drones"]')).toContainText("贸易站 1");
    await timeline(page).press("Space");
    await expect(panel(page).getByRole("button", { name: "暂停", exact: true })).toBeVisible();
    await timeline(page).press("Space");
    await edit(page);
    await play(page).click();
    await expect.poll(async () => Number(await timeline(page).inputValue())).toBeGreaterThanOrEqual(8);
    await expect.poll(async () => Number(await timeline(page).inputValue())).toBeLessThan(9);
    await panel(page).getByRole("button", { name: "暂停", exact: true }).click();
    expect(await requests(page)).toBe(workerCount);
    expect((await savedDraft(page)).shifts).toEqual(before.shifts);
    expect((await savedDraft(page)).activeShift).toBe(1);
  });
}

test("manual morale preserves settings seeks and follows edited schedules and shortened shifts", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/manual");
  await expect(play(page)).toBeEnabled({ timeout: 60_000 });
  await replay(page);
  await timeline(page).press("ArrowRight");
  await expect(timeline(page)).toHaveValue("16.25");
  await choose(page, "周期数", "3");
  await expect(play(page)).toBeEnabled();
  await expect(timeline(page)).toHaveValue("16.25");
  await timeline(page).press("End");
  await expect(timeline(page)).toHaveValue("72");
  await choose(page, "周期数", "1");
  await expect(play(page)).toBeEnabled();
  await expect(timeline(page)).toHaveValue("24");
  await edit(page);
  await board(page).getByRole("button", { name: "清空当前班次所有设施", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "清空当前班次", exact: true }).click();
  await expect(play(page)).toBeEnabled();
  await replay(page);
  await expect(timeline(page)).toHaveValue("16");
  await expect(board(page).locator('[data-room-title="贸易站 1"] [data-operator-identity="阿米娅"]')).toHaveCount(0);
  await panel(page).getByRole("tab", { name: "作业图", exact: true }).click();
  const beforeShortening = await requests(page);
  await choose(page, "班次数", "2 班");
  await expect.poll(async () => (await savedDraft(page)).shifts.length).toBe(2);
  await expect.poll(() => requests(page)).toBeGreaterThan(beforeShortening);
  await expect(panel(page).getByRole("button", { name: "开始播放", exact: true, includeHidden: true })).toBeEnabled();
  const count = await requests(page);
  await page.getByLabel("第一班开始时间", { exact: true }).fill("09:00");
  await replay(page);
  await expect(play(page)).toBeEnabled();
  await expect(timeline(page)).toHaveValue("12");
  await expect(board(page)).toContainText("第 1 周期 · 第 2 班");
  expect(await requests(page)).toBe(count);
});

test("manual morale uses the latest navigation while discarding stale replies and stopping on errors", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/manual");
  await expect(play(page)).toBeEnabled({ timeout: 60_000 });
  await page.evaluate(() => { window.moodWorkerTest.hold = true; });
  await choose(page, "周期数", "2");
  await expect.poll(() => page.evaluate(() => window.moodWorkerTest.held.length)).toBe(1);
  await choose(page, "周期数", "3");
  await expect.poll(() => page.evaluate(() => window.moodWorkerTest.held.length)).toBe(2);
  const count = await requests(page);
  await shift(page, 0);
  await shift(page, 1);
  await replay(page);
  await expect(play(page)).toBeDisabled();
  await expect(board(page)).toHaveCount(0);
  await expect(page.locator('[data-plan-support="morale"]')).toHaveCount(0);
  await page.evaluate(() => window.moodWorkerTest.held.shift()?.());
  await expect(play(page)).toBeDisabled();
  await page.evaluate(() => { window.moodWorkerTest.hold = false; window.moodWorkerTest.held.shift()?.(); });
  await expect(play(page)).toBeEnabled();
  await expect(timeline(page)).toHaveValue("8");
  await expect(board(page)).toContainText("第 1 周期 · 第 2 班");
  expect(await requests(page)).toBe(count);
  await page.evaluate(() => { window.moodWorkerTest.failNext = true; });
  await choose(page, "周期数", "1");
  await expect(panel(page).getByRole("alert")).toContainText("Injected simulation failure");
  await expect(play(page)).toBeDisabled();
  await expect(timeline(page)).toBeDisabled();
  await expect(board(page)).toHaveCount(0);
  await choose(page, "周期数", "2");
  await expect(play(page)).toBeEnabled();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  await expect(timeline(page)).toHaveValue("8");
});

test("manual morale freezes the live playback clock while settings recalculate", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/manual");
  await expect(play(page)).toBeEnabled({ timeout: 60_000 });
  await replay(page);
  await choose(page, "播放速度", "3600×");
  await play(page).click();
  await expect.poll(async () => Number(await timeline(page).inputValue())).toBeGreaterThan(16.5);
  const before = Number(await timeline(page).inputValue());
  await page.evaluate(() => { window.moodWorkerTest.hold = true; });
  await choose(page, "周期数", "2");
  await expect.poll(() => page.evaluate(() => window.moodWorkerTest.held.length)).toBe(1);
  await expect(play(page)).toBeDisabled();
  const stopped = await timeline(page).inputValue();
  expect(Number(stopped)).toBeGreaterThanOrEqual(before);
  // Observe several 100 ms clock ticks while the real worker result is held.
  await page.waitForTimeout(350);
  await expect(timeline(page)).toHaveValue(stopped);
  await page.evaluate(() => { window.moodWorkerTest.hold = false; window.moodWorkerTest.held.shift()?.(); });
  await expect(play(page)).toBeEnabled();
  await expect(timeline(page)).toHaveValue(stopped);
  await expect(panel(page).getByRole("button", { name: "暂停", exact: true })).toHaveCount(0);
});
