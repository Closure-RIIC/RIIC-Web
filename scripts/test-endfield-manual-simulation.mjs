import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY, manualTemplate } from "@riic/endfield-solver/model.mjs";
import { evaluateManual } from "@riic/endfield-solver/index.mjs";
import { STEP_STORAGE_KEY } from "../apps/endfield/src/step/step-keys.ts";
import { RESULT_STORAGE_KEY } from "../apps/endfield/src/result-cache.ts";

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
  // Exercise cancellation with real workers, delaying only when the slow-worker case requests it.
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = class extends NativeWorker {
      postMessage(message, ...options) {
        const delay = globalThis.manualEvaluationDelay ?? 0;
        if (!delay) { super.postMessage(message, ...options); return; }
        globalThis.setTimeout(() => super.postMessage(message, ...options), delay);
      }
    };
  });
  let evaluationWorkers = 0;
  page.on("worker", () => { evaluationWorkers++; });
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", error => errors.push(error.message));
  const choose = async (label, value, root = page) => {
    await root.getByRole("combobox", { name: label, exact: true }).first().fill(value);
    await page.getByRole("option", { name: value, exact: true }).click();
  };
  const readWorkspace = () => page.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key)), STORAGE_KEY);
  const expectEvaluation = async (target = page) => {
    await expect(target.locator("[data-manual-assignments]")).toHaveAttribute("data-evaluation-state", "ready");
    const current = await target.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key)), STORAGE_KEY);
    const assignments = manualTemplate(current.options).map(room => {
      const saved = current.manual?.find(item => item.key === room.key) ?? room;
      return { ...room, hour: saved.hour, a: saved.a.filter(Boolean), b: saved.b.filter(Boolean) };
    });
    const evaluated = evaluateManual(current, assignments);
    assert.equal(evaluated.verification.ok, true, evaluated.verification.errors.join("; "));
    for (const room of evaluated.rooms) {
      await expect(target.locator(`[data-manual-output="${room.key}"] [data-animated-value]`)).toHaveAttribute("aria-label", room.value.toFixed(2));
    }
    await expect.poll(() => target.locator('[data-manual-board] [data-facility="center"] .ef-facility-bonus [data-animated-value]').evaluateAll(elements => elements.map(el => el.getAttribute("aria-label")))).toEqual(
      [evaluated.center.recoveryA, evaluated.center.recoveryB].map(value => `+${(value * 100).toFixed(1)}%`));
    await expect.poll(() => target.locator("[data-manual-board] .ef-output-summary [data-animated-value]").evaluateAll(elements => elements.map(el => el.getAttribute("aria-label")))).toEqual(Object.values(evaluated.scores).map(value => value.toFixed(2)));
    await expect(target.locator('[data-activity-kind="manual"]')).toHaveCount(0);
    assert.equal(await target.evaluate(key => globalThis.localStorage.getItem(key), RESULT_STORAGE_KEY), null, "Manual evaluation must not create an automatic-plan cache");
    return evaluated;
  };
  const edit = () => page.getByRole("tab", { name: "编辑排班", exact: true }).click();
  const replay = () => page.getByRole("tab", { name: "模拟回放", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "模拟设置", exact: true });
  const openSettings = () => page.getByRole("button", { name: "模拟设置", exact: true }).click();
  const closeSettings = () => settings.getByRole("button", { name: "完成", exact: true }).click();
  const expectPlaybackRow = async () => {
    await page.locator(".ef-step-playback").waitFor({ state: "visible" });
    const controls = await page.locator(".ef-step-playback > .ef-action, .ef-step-playback .ef-field-control").evaluateAll(elements => elements.map(el => {
      const bounds = el.getBoundingClientRect();
      return { center: bounds.y + bounds.height / 2, left: bounds.left, right: bounds.right };
    }));
    assert.equal(controls.length, 6);
    assert.ok(Math.max(...controls.map(control => control.center)) - Math.min(...controls.map(control => control.center)) <= 2, "playback buttons, speed and settings share a row");
    const row = await page.locator(".ef-step-playback").boundingBox();
    assert.ok(controls.every(control => control.left >= row.x && control.right <= row.x + row.width + 1), "all playback controls fit in the row");
  };
  const response = await page.goto(entry);
  assert.equal(response.status(), 200);
  await page.locator("body[data-app-hydrated=true]").waitFor();
  await expect(page).toHaveURL(`${origin}/manual?view=simulation`);
  await expect(page.getByRole("heading", { name: "手动排班", exact: true })).toBeVisible();
  await expect(page.locator(".ef-manual-page > .ef-title .ef-subtitle")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "模拟控制", exact: true })).toHaveCount(0);
  await expect(page.locator(".ef-step-playback [role=status]")).toHaveCount(0);
  await expectPlaybackRow();
  await expect(page.getByText("与编辑视图共用排班。修改人员、设施或换班时间后，回放重置，模拟参数保留。", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-manual-board]")).toHaveCount(1);
  await expect(page.locator("[data-step-slot], #importFromManualBtn, #importFromResultBtn")).toHaveCount(0);
  await expect(page.locator('a.ef-nav-link[href="/step"]')).toHaveCount(0);
  await expect(page.locator('a.ef-nav-link[href="/manual"]')).toHaveAttribute("aria-current", "page");
  await edit();
  await expect(page.getByRole("combobox", { name: "换班整点", exact: true }).first()).toHaveValue("12:00");
  await expect.poll(async () => {
    const board = await page.locator("[data-manual-board]").boundingBox();
    const tabs = await page.getByRole("tablist", { name: "排班视图", exact: true }).boundingBox();
    return board.y - tabs.y - tabs.height;
  }).toBeGreaterThanOrEqual(16);
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
  await expect(page.locator("#fastBtn")).toBeDisabled();
  await expect(page.locator("#statsArea table").first().locator("tbody tr")).toHaveCount(2);
  const timeline = page.getByRole("slider", { name: "模拟时间轴", exact: true });
  await expect(timeline).toHaveValue("172800");
  const firstCard = page.locator(`[data-step-operator="${nextName}"]`);
  const secondCard = page.locator(`[data-step-operator="${workspace.manual[0].b[0]}"]`);
  const charts = page.locator("[data-step-chart]");
  await expect(page.getByRole("button", { name: "全部干员曲线", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "只看选中干员", exact: true })).toHaveCount(0);
  await expect(firstCard).toHaveAttribute("aria-pressed", "true");
  await expect(secondCard).toHaveAttribute("aria-pressed", "true");
  await expect(charts).toHaveCount(2);
  await expect(charts.first().getByText("48h", { exact: true })).toBeVisible();
  await expect(charts.first().getByText("100%", { exact: true })).toBeVisible();
  await firstCard.click();
  await expect(firstCard).toHaveAttribute("aria-pressed", "false");
  await expect(secondCard).toHaveAttribute("aria-pressed", "true");
  await expect(charts.first().locator(".recharts-line")).toHaveCount(1);
  await expect(page.locator(".ef-mood-legend").first()).toContainText(workspace.manual[0].b[0]);
  await expect(page.locator(".ef-mood-legend").first()).not.toContainText(nextName);
  await secondCard.click();
  await expect(charts.first().locator(".recharts-line")).toHaveCount(0);
  await expect(page.getByText("点击干员卡片选择要显示的心情曲线。", { exact: true })).toBeVisible();
  await expect(charts.nth(1).locator(".recharts-line")).toHaveCount(1);
  await firstCard.focus();
  await firstCard.press("Space");
  await expect(firstCard).toHaveAttribute("aria-pressed", "true");
  await expect(charts.first().locator(".recharts-line")).toHaveCount(1);
  await secondCard.click();
  await expect(charts.first().locator(".recharts-line")).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "搜索模拟干员", exact: true })).toHaveCount(0);
  await firstCard.click();
  await expect(firstCard).toHaveAttribute("aria-pressed", "false");
  await expect(secondCard).toHaveAttribute("aria-pressed", "true");
  await expect(charts.first().locator(".recharts-line")).toHaveCount(1);
  await facilityTabs.nth(1).click();
  await expect(charts.first().locator(".recharts-line")).toHaveCount(2);
  await facilityTabs.first().click();
  await expect(firstCard).toHaveAttribute("aria-pressed", "false");
  await expect(secondCard).toHaveAttribute("aria-pressed", "true");
  await expect(charts.first().locator(".recharts-line")).toHaveCount(1);
  await firstCard.click();
  await expect(charts.first().locator(".recharts-line")).toHaveCount(2);
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
  await expect(charts.first().locator(".recharts-surface")).toBeFocused();
  await expect(charts.first().locator(".recharts-surface")).toHaveCSS("outline-style", "none");
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(3600);
  await expect(page.locator("#pauseBtn")).toBeDisabled();
  for (const section of await page.locator("#manual-simulation > .ef-section, .ef-step-report").all()) {
    await expect(section).toHaveCSS("border-top-width", "0px");
  }
  await expect(page.locator(".ef-step-operator-scroll [data-yeye-scroll=y]")).toHaveCount(1);
  await page.locator(".ef-step-report > summary").click();
  await expect(page.locator("#logList [data-yeye-scroll=y]")).toHaveCount(1);
  await page.locator("#resetBtn").click();
  await expect(page.locator("#timeInfo")).toContainText("尚未开始");

  // Long-term output updates in the original cards without an evaluation action.
  await page.locator("#startBtn").click();
  await edit();
  await expect(page.locator("#manual-simulation")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "评估方案", exact: true })).toHaveCount(0);
  await expectEvaluation();
  await expect(page.getByRole("button", { name: "详细报告", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "使用当前双班结果", exact: true })).toBeDisabled();
  await expect(page.locator("[data-manual-board] .ef-facility-tile")).toHaveCount(3);
  await expect(page.locator(".ef-schedule-result, [data-schedule-board]")).toHaveCount(0);
  await page.getByRole("button", { name: "详细报告", exact: true }).click();
  const report = page.getByRole("dialog", { name: "排班报告", exact: true });
  await expect(report.getByText("人员、工位与产出重算校验通过。", { exact: true })).toBeVisible();
  await report.getByRole("button", { name: "完成", exact: true }).click();
  console.log("Automatic evaluation: checking cancellation and persistent figures");
  // Supersede a slow real worker while editing remains available and figures stay mounted.
  const preceding = await expectEvaluation();
  await page.evaluate(() => { globalThis.manualEvaluationDelay = 1500; });
  const precedingWorkers = evaluationWorkers;
  await choose("换班整点", "14:00");
  await expect.poll(() => evaluationWorkers).toBeGreaterThan(precedingWorkers);
  await expect(page.locator("[data-manual-assignments]")).toHaveAttribute("data-evaluation-state", "pending");
  await expect.poll(() => page.locator("[data-manual-output] [data-animated-value]").evaluateAll(elements => elements.map(el => el.getAttribute("aria-label")))).toEqual(preceding.rooms.map(room => room.value.toFixed(2)));
  await expect(page.locator("[data-manual-board] .ef-output-summary")).toHaveCount(1);
  await expect(page.locator("[data-manual-board] .ef-facility-bonus")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "详细报告", exact: true })).toBeDisabled();
  await expect(slot).toBeEnabled();
  await choose("换班整点", "15:00");
  await page.waitForFunction(key => JSON.parse(globalThis.localStorage.getItem(key)).manual[0].hour === 15, STORAGE_KEY);
  await expectEvaluation();
  await page.evaluate(() => { globalThis.manualEvaluationDelay = 0; });
  await page.getByRole("button", { name: "详细报告", exact: true }).click();
  await expect(report).toContainText("15:00");
  await report.getByRole("button", { name: "完成", exact: true }).click();

  // Removing, restoring and replacing production crew updates output even with a vacant shift.
  const productionSlot = page.locator('[data-manual-slot="制造舱1:a:0"]');
  const productionCrew = workspace.manual.find(room => room.key === "制造舱1").a[0];
  const beforeRemoval = await expectEvaluation();
  await productionSlot.click();
  await picker.getByRole("button", { name: "清空工位", exact: true }).click();
  await page.waitForFunction(key => !JSON.parse(globalThis.localStorage.getItem(key)).manual.find(room => room.key === "制造舱1").a[0], STORAGE_KEY);
  const afterRemoval = await expectEvaluation();
  assert.ok(afterRemoval.rooms.find(room => room.key === "制造舱1").value < beforeRemoval.rooms.find(room => room.key === "制造舱1").value);
  await productionSlot.click();
  await picker.locator(`[data-operator-name="${firstName}"]`).click();
  await page.waitForFunction(({ key, name }) => JSON.parse(globalThis.localStorage.getItem(key)).manual.find(room => room.key === "制造舱1").a[0] === name, { key: STORAGE_KEY, name: firstName });
  await expectEvaluation();
  await productionSlot.click();
  await picker.locator(`[data-operator-name="${productionCrew}"]`).click();
  await page.waitForFunction(({ key, name }) => JSON.parse(globalThis.localStorage.getItem(key)).manual.find(room => room.key === "制造舱1").a[0] === name, { key: STORAGE_KEY, name: productionCrew });
  await expectEvaluation();
  console.log("Automatic evaluation: checking dialog return and animation");
  // Facility edits leave the old figures in place until the main panel becomes visible again.
  const oldNumbers = await page.locator("[data-manual-output] [data-animated-value]").evaluateAll(elements => elements.map(el => el.getAttribute("aria-label")));
  await page.getByRole("button", { name: "设施与生产", exact: true }).click();
  const facilities = page.getByRole("dialog", { name: "设施与生产", exact: true });
  const workersBeforeDialogEdit = evaluationWorkers;
  await choose("制造舱布局", "2干员", facilities);
  await page.waitForFunction(key => JSON.parse(globalThis.localStorage.getItem(key)).options.mfg === "2干员", STORAGE_KEY);
  await expect(page.locator("[data-manual-assignments]")).toHaveAttribute("data-evaluation-state", "editing");
  assert.equal(evaluationWorkers, workersBeforeDialogEdit, "Do not evaluate behind the editing dialog");
  assert.deepEqual(await page.locator("[data-manual-output] [data-animated-value]").evaluateAll(elements => elements.map(el => el.getAttribute("aria-label"))), oldNumbers);
  await facilities.getByRole("button", { name: "完成", exact: true }).click();
  await expectEvaluation();
  await expect(page.locator("[data-manual-output] [data-calligraph]")).toHaveCount(2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-manual-output] [data-calligraph]")).toHaveCount(0);
  await expectEvaluation();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await choose("换班整点", "13:00");
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
  await expectPlaybackRow();
  await page.locator("#fastBtn").click();
  await expect(charts.first()).toBeVisible();
  await expect(charts.nth(1)).toBeVisible();
  await firstCard.click();
  await expect(firstCard).toHaveAttribute("aria-pressed", "false");
  await expect(charts.first().locator(".recharts-line")).toHaveCount(1);
  await firstCard.click();
  await expect(firstCard).toHaveAttribute("aria-pressed", "true");
  await expect(charts.first().locator(".recharts-line")).toHaveCount(2);
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
  await expect(page.getByRole("heading", { name: "Simulation replay", exact: true })).toHaveCount(0);
  await expectPlaybackRow();

  const openFixture = async (fixture, locale) => {
    const fixtureContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await fixtureContext.addInitScript(({ key, workspace, origin, locale }) => {
      if (globalThis.location.origin !== origin || globalThis.sessionStorage.getItem("fixture-seeded")) return;
      globalThis.localStorage.setItem(key, JSON.stringify(workspace));
      globalThis.document.cookie = `riic-endfield-locale=${locale};path=/`;
      globalThis.document.cookie = "sidebar_state=true;path=/";
      globalThis.sessionStorage.setItem("fixture-seeded", "1");
    }, { key: STORAGE_KEY, workspace: fixture, origin, locale });
    const fixturePage = await fixtureContext.newPage();
    fixturePage.on("pageerror", error => errors.push(error.message));
    await fixturePage.goto(entry);
    await fixturePage.locator("body[data-app-hydrated=true]").waitFor();
    return fixturePage;
  };

  // The complete editor fits on common desktop screens at the home page's normal card scale.
  const compactOptions = { ...DEFAULT_OPTIONS, levels: { center: 5, mfg1: 3, mfg2: 3, guest: 3, grow: 3 }, grow: { 晶植: 9, 菌类: 0, 矿物: 0 } };
  let fullRosterIndex = 0;
  const compactWorkspace = { version: 1, operators: catalog.map(op => ({ name: op.name, elite: 4 })), options: compactOptions,
    manual: manualTemplate(compactOptions).map(room => ({ ...room,
      a: Array.from({ length: room.slots }, () => catalog[fullRosterIndex++].name),
      b: Array.from({ length: room.slots }, () => catalog[fullRosterIndex++].name) })) };
  const layoutPage = await openFixture(compactWorkspace, "en");
  console.log("Automatic evaluation: checking desktop layout and empty roster");
  await layoutPage.getByRole("tab", { name: "Edit schedule", exact: true }).click();
  await expect(layoutPage.locator("[data-manual-board] .ef-facility-tile")).toHaveCount(5);
  await expect(layoutPage.locator('[data-activity-kind="roster"]')).toHaveCount(0);
  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 720]]) {
    await layoutPage.setViewportSize({ width, height });
    await layoutPage.locator("[data-app-scroll-area=endfield]").evaluate(el => { el.scrollTop = 0; });
    await expect.poll(async () => {
      const board = await layoutPage.locator("[data-manual-board]").boundingBox();
      const scroll = await layoutPage.locator("[data-app-scroll-area=endfield]").boundingBox();
      return board.y >= scroll.y && board.y + board.height <= Math.min(height, scroll.y + scroll.height);
    }).toBe(true);
  }
  await layoutPage.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => layoutPage.locator("[data-manual-board]").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

  const emptyPage = await openFixture({ version: 1, operators: [], options: DEFAULT_OPTIONS }, "zh");
  await emptyPage.getByRole("tab", { name: "编辑排班", exact: true }).click();
  const rosterHint = emptyPage.locator('[data-activity-kind="roster"]');
  await expect(rosterHint).toBeVisible();
  await expect(emptyPage.locator(".ef-manual-page .ef-notice").filter({ hasText: "请先配置我的干员" })).toHaveCount(0);
  await expect(rosterHint).toBeHidden({ timeout: 6000 });
  await expectEvaluation(emptyPage);
  await expect(emptyPage.locator('[data-manual-output] [data-animated-value][aria-label="0.00"]')).toHaveCount(4);
  await emptyPage.getByRole("tab", { name: "模拟回放", exact: true }).click();
  await emptyPage.getByRole("tab", { name: "编辑排班", exact: true }).click();
  await expect(rosterHint).toBeHidden();
  await emptyPage.locator("[data-manual-slot]").first().click();
  const rosterDialog = emptyPage.getByRole("dialog", { name: "我的干员", exact: true });
  await expect(rosterDialog).toBeVisible();
  await rosterDialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(rosterDialog).toBeHidden();
  await emptyPage.locator('a.ef-nav-link[href="/"]').click();
  await emptyPage.locator('a.ef-nav-link[href="/manual"]').click();
  await expect(rosterHint).toBeVisible();
  await rosterHint.getByRole("button", { name: "配置干员", exact: true }).click();
  await expect(rosterDialog).toBeVisible();
  await rosterDialog.getByRole("button", { name: `拥有${catalog[0].name}`, exact: true }).click();
  await rosterDialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(rosterHint).toBeHidden();
  await emptyPage.locator("[data-manual-slot]").first().click();
  await expect(emptyPage.getByRole("dialog", { name: "选择干员", exact: true })).toBeVisible();
  await emptyPage.getByRole("dialog", { name: "选择干员", exact: true }).getByRole("button", { name: "取消", exact: true }).click();

  // Invalid manual results use the common Live Activity, with a local evaluation retry.
  const recoveryOperator = catalog.find(op => op.skills.some(skill => skill.room === "总控中枢" && skill.effectKey === "MoodRecoveryAll"));
  const invalidWorkspace = { version: 1, operators: [{ name: recoveryOperator.name, elite: 4 }], options: DEFAULT_OPTIONS,
    manual: manualTemplate(DEFAULT_OPTIONS).map(room => room.key === "中枢" ? { ...room, hour: 23, a: [recoveryOperator.name] } : room) };
  const invalidResult = evaluateManual(invalidWorkspace, invalidWorkspace.manual);
  assert.equal(invalidResult.verification.ok, false, "The fixture must fail real independent verification");
  const errorPage = await openFixture(invalidWorkspace, "zh");
  let errorWorkers = 0;
  errorPage.on("worker", () => { errorWorkers++; });
  await errorPage.getByRole("tab", { name: "编辑排班", exact: true }).click();
  const failure = errorPage.locator('[data-activity-kind="evaluation"][data-activity-phase="error"]');
  await expect(failure).toBeVisible();
  await expect(failure).toHaveAttribute("aria-label", "方案校验未通过");
  for (const message of invalidResult.verification.errors) await expect(failure.locator(".ef-live-description")).toContainText(message);
  await expect(errorPage.locator(".ef-manual-page > .ef-notice--error")).toHaveCount(0);
  await expect(errorPage.locator('[data-manual-output] [data-animated-value][aria-label="—"]')).toHaveCount(4);
  const workersBeforeRetry = errorWorkers;
  await failure.getByRole("button", { name: "重试", exact: true }).click();
  await expect.poll(() => errorWorkers).toBeGreaterThan(workersBeforeRetry);
  await expect(failure).toBeVisible();
  await expect(errorPage.locator('[data-activity-kind="schedule"], [data-activity-kind="manual"]')).toHaveCount(0);
  await expect(errorPage.locator("[data-manual-slot]").first()).toBeEnabled();
  await failure.getByRole("button", { name: "关闭求解提示", exact: true }).click();
  await expect(failure).toHaveCount(0);
  await errorPage.getByRole("combobox", { name: "换班整点", exact: true }).first().fill("12:00");
  await errorPage.getByRole("option", { name: "12:00", exact: true }).click();
  await expectEvaluation(errorPage);
  await expect(failure).toHaveCount(0);

  // The Wiki presents the same full catalog for an empty, partial or complete personal roster.
  const wikiPage = await openFixture({ version: 1, operators: [], options: DEFAULT_OPTIONS }, "zh");
  let wikiContents;
  for (const fixturePage of [wikiPage, emptyPage, layoutPage]) {
    await fixturePage.setViewportSize({ width: 1440, height: 900 });
    await fixturePage.evaluate(() => { globalThis.document.cookie = "riic-endfield-locale=zh;path=/"; });
    await fixturePage.goto(`${origin}/skills`);
    await fixturePage.locator("body[data-app-hydrated=true]").waitFor();
    const cards = fixturePage.locator(".ef-roster-grid--skills .ef-roster-card");
    await expect(cards).toHaveCount(catalog.length);
    await expect(fixturePage.locator(".ef-roster-stage, .ef-operator-skill-stage, .ef-ship-skill[data-locked], .ef-roster-card[data-selected]")).toHaveCount(0);
    await expect(fixturePage.getByRole("button", { name: /仅查看已拥有|仅已选/ })).toHaveCount(0);
    const contents = await cards.allTextContents();
    if (wikiContents) assert.deepEqual(contents, wikiContents);
    else wikiContents = contents;
  }
  const wikiWorkspace = await wikiPage.evaluate(key => globalThis.localStorage.getItem(key), STORAGE_KEY);
  await wikiPage.getByRole("tablist", { name: "稀有度筛选", exact: true }).getByRole("tab", { name: "6★", exact: true }).click();
  await expect(wikiPage.locator(".ef-roster-card")).toHaveCount(catalog.filter(op => op.rarity === 6).length);
  await wikiPage.getByRole("button", { name: "清除选择", exact: true }).click();
  await wikiPage.getByLabel("搜索干员或技能", { exact: true }).fill(catalog[0].name);
  await expect(wikiPage.locator(`.ef-roster-card[data-operator-id="${catalog[0].id}"]`)).toBeVisible();
  await wikiPage.getByRole("button", { name: "清空搜索", exact: true }).click();
  await wikiPage.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => wikiPage.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth)).toBeLessThanOrEqual(1);
  assert.equal(await wikiPage.evaluate(key => globalThis.localStorage.getItem(key), STORAGE_KEY), wikiWorkspace, "Browsing the Wiki must not modify the personal roster");
  await wikiPage.evaluate(() => { globalThis.document.cookie = "riic-endfield-locale=en;path=/"; });
  await wikiPage.reload();
  await wikiPage.locator("body[data-app-hydrated=true]").waitFor();
  await expect(wikiPage.locator(".ef-roster-card")).toHaveCount(catalog.length);
  await expect(wikiPage.locator(".ef-roster-stage, .ef-operator-skill-stage, .ef-ship-skill[data-locked]")).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ["legacy redirect and single sidebar entry", "legacy storage migration", "shared timetable and roster reset playback", "settings dialog and parameter persistence", "pause resume fast-forward reset", "operator card single/multiple selection and facility persistence", "original charts and timeline seeking", "single-row playback toolbar and full-facility editor at normal card scale", "temporary roster live activity and setup entry after dismissal", "simplified replay layout, chart focus and editor spacing", "automatic inline evaluation, full report, vacant shifts and empty roster", "editing during slow evaluation, superseded worker and unchanged automatic-plan cache", "roster-independent skills catalog, filters and unchanged personal roster", "dark theme, mobile and English"], pageErrors: errors }));
} finally { await browser.close(); }
