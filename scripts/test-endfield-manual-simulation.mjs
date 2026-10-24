import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY, manualTemplate } from "@riic/endfield-solver/model.mjs";
import { STEP_STORAGE_KEY } from "../apps/endfield/src/step/step-keys.ts";

// Run against a local Endfield server with an isolated preview session.
// ENDFIELD_E2E_ENTRY may point to a local preview login redirect.
const origin = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
const entry = process.env.ENDFIELD_E2E_ENTRY || `${origin}/step`;
for (const address of [origin, entry]) {
  if (!["127.0.0.1", "localhost"].includes(new URL(address).hostname)) throw new Error("This test is local-only");
}
const workspace = { version: 1, operators: catalog.slice(0, 8).map(op => ({ name: op.name, elite: 4 })),
  options: { ...DEFAULT_OPTIONS, levels: { center: 1, mfg1: 1, mfg2: 1, guest: 0, grow: 0 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } } };
let cursor = 0;
workspace.manual = manualTemplate(workspace.options).map(room => ({ ...room, hour: 12,
  a: Array.from({ length: room.slots }, () => catalog[cursor++].name),
  b: Array.from({ length: room.slots }, () => catalog[cursor++].name) }));
const firstName = workspace.manual[0].a[0];
const nextName = catalog[cursor].name;
const legacy = { version: 1, rooms: { 中枢: { enabled: false, hour: 22 } }, moods: { [firstName]: 75 }, work: {},
  boost: { dailyCount: 1, currentDay: 0, days: [{ list: [{ hour: 13, minute: 30, target: firstName }] }] } };
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ key, stepKey, workspace, legacy, origin }) => {
    if (globalThis.location.origin !== origin || globalThis.sessionStorage.getItem("manual-sim-seeded")) return;
    globalThis.localStorage.setItem(key, JSON.stringify(workspace));
    globalThis.localStorage.setItem(stepKey, JSON.stringify(legacy));
    globalThis.localStorage.setItem("riic-color-mode", "light");
    globalThis.document.cookie = "riic-endfield-locale=zh;path=/";
    globalThis.document.cookie = "sidebar_state=true;path=/";
    globalThis.sessionStorage.setItem("manual-sim-seeded", "1");
  }, { key: STORAGE_KEY, stepKey: STEP_STORAGE_KEY, workspace, legacy, origin });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", error => errors.push(error.message));
  const choose = async (label, value, root = page) => {
    await root.getByRole("combobox", { name: label, exact: true }).first().fill(value);
    await page.getByRole("option", { name: value, exact: true }).click();
  };
  const readWorkspace = () => page.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key)), STORAGE_KEY);
  const edit = () => page.getByRole("tab", { name: "编辑排班", exact: true }).click();
  const replay = () => page.getByRole("tab", { name: "模拟回放", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "模拟设置", exact: true });
  const openSettings = () => page.getByRole("button", { name: "模拟设置", exact: true }).click();
  const closeSettings = () => settings.getByRole("button", { name: "完成", exact: true }).click();
  const response = await page.goto(entry);
  assert.equal(response.status(), 200);
  await page.locator("body[data-app-hydrated=true]").waitFor();
  await expect(page).toHaveURL(`${origin}/manual?view=simulation`);
  await expect(page.getByRole("heading", { name: "手动排班", exact: true })).toBeVisible();
  await expect(page.locator("[data-manual-board]")).toHaveCount(1);
  await expect(page.locator("[data-step-slot], #importFromManualBtn, #importFromResultBtn")).toHaveCount(0);
  await expect(page.locator('a.ef-nav-link[href="/step"]')).toHaveCount(0);
  await expect(page.locator('a.ef-nav-link[href="/manual"]')).toHaveAttribute("aria-current", "page");
  await edit();
  await expect(page.getByRole("combobox", { name: "换班整点", exact: true }).first()).toHaveValue("12:00");
  await replay();
  await openSettings();
  await expect(page.locator(`[data-step-mood="${firstName}"]`)).toHaveValue("75");
  await page.locator("#startHour").fill("9");
  await choose("模拟时长", "48 h");
  await settings.locator(".ef-step-boost-entry").first().getByRole("button").click();
  const assistPicker = page.getByRole("dialog", { name: "助力目标 · 第 1 天 · 第 1 次", exact: true });
  await expect(assistPicker.locator(`[data-operator-name="${nextName}"]`)).toBeDisabled();
  await assistPicker.locator(`[data-operator-name="${workspace.manual[0].b[0]}"]`).click();
  await expect(assistPicker).toBeHidden();
  await expect(settings).toBeVisible();
  await closeSettings();
  await page.locator("#startBtn").click();
  await expect(page.locator("#pauseBtn")).toBeEnabled();
  await expect(page.locator("#logList")).toContainText("一轮 12h");
  const facilityTabs = page.getByRole("tablist", { name: "模拟舱室", exact: true }).getByRole("tab");
  await expect(facilityTabs).toHaveCount(3);
  await choose("播放速度", "1000×");
  await expect(page.locator("#pauseBtn")).toBeEnabled();
  await expect(page.locator("#timeInfo")).not.toContainText("尚未开始");
  assert.deepEqual((await readWorkspace()).manual, workspace.manual, "simulation controls never mutate the schedule");

  // Changing the shared timetable stops playback, keeps parameters and uses the new time.
  await edit();
  await expect(page.locator("#manual-simulation")).toHaveCount(0);
  await choose("换班整点", "13:00", page.locator("[data-manual-board]"));
  await replay();
  await expect(page.locator("#timeInfo")).toContainText("尚未开始");
  await expect(page.locator("#pauseBtn")).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "播放速度", exact: true })).toHaveValue("1000×");
  await openSettings();
  await expect(page.locator("#startHour")).toHaveValue("9");
  await expect(page.getByRole("combobox", { name: "模拟时长", exact: true })).toHaveValue("48 h");
  await closeSettings();
  await page.locator("#startBtn").click();
  await expect(page.locator("#logList")).toContainText("一轮 13h");

  const slot = page.locator("[data-manual-slot]").first();
  await edit();
  await slot.click();
  const picker = page.getByRole("dialog", { name: "选择干员", exact: true });
  await expect(picker.locator(`[data-operator-name="${workspace.manual[0].b[0]}"]`)).toBeDisabled();
  await picker.locator(`[data-operator-name="${nextName}"]`).click();
  await expect(picker).toBeHidden();
  await expect(slot).toContainText(nextName);
  await replay();
  await expect(page.locator("#pauseBtn")).toBeDisabled();
  await expect(page.locator("#timeInfo")).toContainText("尚未开始");
  await page.locator("#startBtn").click();
  await expect(page.locator(".ef-mood-people")).toContainText(nextName);
  await expect(page.locator(".ef-mood-people")).not.toContainText(firstName);
  await page.locator("#pauseBtn").click();
  await expect(page.locator("#startBtn")).toHaveText("继续");
  await page.locator("#startBtn").click();
  await page.locator("#fastBtn").click();
  await expect(page.getByRole("status").filter({ hasText: /^模拟完成$/ })).toBeVisible();
  await expect(page.locator("#statsArea table").first().locator("tbody tr")).toHaveCount(2);
  const timeline = page.getByRole("slider", { name: "模拟时间轴", exact: true });
  await expect(timeline).toHaveValue("172800");
  await page.locator(`[data-step-operator="${workspace.manual[0].b[0]}"]`).click();
  await expect(page.locator("[data-step-detail]")).toHaveAttribute("data-step-detail", workspace.manual[0].b[0]);
  await expect(page.locator("[data-slot=chart]")).toHaveCount(2);
  await expect(page.locator("[data-slot=chart]").first().locator(".recharts-line")).toHaveCount(1);
  await facilityTabs.nth(1).click();
  await expect(page.locator("[data-step-detail]")).toHaveAttribute("data-step-detail", "all");
  await expect(page.locator("[data-slot=chart]").first().locator(".recharts-line")).toHaveCount(2);
  await facilityTabs.first().click();
  await timeline.focus();
  await timeline.press("Home");
  await expect(timeline).toHaveValue("0");
  await expect(page.locator("#timeInfo")).toContainText("09:00:00");
  await timeline.press("ArrowRight");
  await expect(timeline).toHaveValue("60");
  await expect(page.locator("#timeInfo")).toContainText("09:01:00");
  const plot = page.locator("[data-step-chart-seek]").first();
  await expect(plot).toBeVisible();
  const bounds = await plot.boundingBox();
  await plot.click({ position: { x: bounds.width * 0.6, y: bounds.height * 0.4 } });
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(3600);
  await expect(page.locator("#pauseBtn")).toBeDisabled();
  await expect(page.locator(".ef-step-operator-scroll [data-yeye-scroll=y]")).toHaveCount(1);
  await page.locator(".ef-step-report > summary").click();
  await expect(page.locator("#logList [data-yeye-scroll=y]")).toHaveCount(1);
  await page.locator("#resetBtn").click();
  await expect(page.locator("#timeInfo")).toContainText("尚未开始");

  // The ordinary evaluator remains available and returning to replay retains preferences.
  await page.locator("#startBtn").click();
  await page.getByRole("button", { name: "评估方案", exact: true }).click();
  await expect(page.locator("#manual-simulation")).toHaveCount(0);
  await expect(page.getByText("人员、工位与产出重算校验通过。", { exact: true })).toBeVisible();
  await replay();
  await openSettings();
  await expect(page.locator("#startHour")).toHaveValue("9");
  await closeSettings();
  await expect(page.locator("#timeInfo")).toContainText("尚未开始");
  await page.reload();
  await page.locator("body[data-app-hydrated=true]").waitFor();
  await openSettings();
  await expect(page.locator("#startHour")).toHaveValue("9");
  await closeSettings();
  await edit();
  await expect(page.getByRole("combobox", { name: "换班整点", exact: true }).first()).toHaveValue("13:00");
  await replay();
  const saved = await page.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key)), STEP_STORAGE_KEY);
  assert.equal(saved.version, 2);
  assert.equal("rooms" in saved, false);
  assert.equal(saved.moods[firstName], 75);
  const light = await page.locator(".ef-step-page").evaluate(el => globalThis.getComputedStyle(el).getPropertyValue("--ef-raised"));
  await page.evaluate(() => { globalThis.localStorage.setItem("riic-color-mode", "dark"); globalThis.dispatchEvent(new Event("focus")); });
  await expect(page.locator("html")).toHaveClass(/dark/);
  assert.notEqual(light, await page.locator(".ef-step-page").evaluate(el => globalThis.getComputedStyle(el).getPropertyValue("--ef-raised")));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth)).toBeLessThanOrEqual(1);
  await page.locator("[data-slot=sidebar-trigger]:visible").first().click();
  const mobile = page.locator("[data-mobile=true]");
  await expect(mobile).toBeVisible();
  await mobile.locator('a[href="/manual"]').click();
  await expect(mobile).toBeHidden();
  await replay();
  await page.evaluate(() => { globalThis.document.cookie = "riic-endfield-locale=en;path=/"; });
  await page.reload();
  await page.locator("body[data-app-hydrated=true]").waitFor();
  await expect(page.getByRole("heading", { name: "Manual schedule", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Simulation replay", exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ["legacy redirect and single sidebar entry", "legacy storage migration", "shared timetable and roster reset playback", "settings dialog and parameter persistence", "pause resume fast-forward reset", "shared charts, operator selection and timeline seeking", "evaluation and replay", "dark theme, mobile and English"], pageErrors: errors }));
} finally { await browser.close(); }
