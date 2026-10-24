import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY, manualTemplate, solve } from "@riic/endfield-solver/index.mjs";

const origin = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
const entry = process.env.ENDFIELD_E2E_ENTRY || origin;
for (const address of [origin, entry]) if (!["127.0.0.1", "localhost"].includes(new URL(address).hostname)) throw new Error("Local preview only");
const input = {
  version: 1, operators: catalog.slice(0, 8).map(op => ({ name: op.name, elite: 0 })),
  options: { ...DEFAULT_OPTIONS, levels: { center: 1, mfg1: 1, mfg2: 1, grow: 0, guest: 0 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 }, time: 30000, budget: 10000 },
};
const result = solve(input);
assert.ok(result.center && result.verification.ok);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (entry === origin) await context.route("**/api/auth/get-session**", route => route.fulfill({ contentType: "application/json", body: "null" }));
  await context.addCookies([{ name: "riic-endfield-locale", value: "zh", url: origin }]);
  await context.addInitScript(({ origin, key, input }) => {
    if (globalThis.location.origin !== origin) return;
    if (!globalThis.localStorage.getItem(key)) globalThis.localStorage.setItem(key, JSON.stringify(input));
    // Control only the solver transport to exercise long-running, stale and failed tasks deterministically.
    // Real worker execution is covered separately by test-endfield-e2e.mjs.
    const NativeWorker = globalThis.Worker;
    globalThis.__solverWorkers = [];
    globalThis.Worker = class {
      constructor(url, options) {
        if (!String(url).includes("solver.worker")) return new NativeWorker(url, options);
        this.terminated = false;
        globalThis.__solverWorkers.push(this);
      }
      postMessage(request) { this.request = request; }
      terminate() { this.terminated = true; }
    };
  }, { origin, key: STORAGE_KEY, input });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(entry);
  if (new URL(page.url()).pathname !== "/") await page.goto(origin);
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  const live = page.locator('[data-slot="live-activity"]');
  const generate = page.getByRole("button", { name: "生成排班", exact: true });
  const emit = async (message, index = -1) => page.evaluate(({ message, index }) => {
    globalThis.__solverWorkers.at(index).onmessage?.({ data: message });
  }, { message, index });
  await generate.click();
  await expect(live).toHaveAttribute("data-activity-phase", "running");
  await expect(live).toHaveAttribute("data-activity-view", "expanded");
  await emit({ type: "progress", progress: { stage: "searching", elapsedMs: 100 } });
  await expect(live).toHaveAttribute("data-solver-stage", "searching");
  await expect(page.getByRole("button", { name: "正在搜索…", exact: true })).toBeDisabled();
  assert.equal(await page.evaluate(() => globalThis.__solverWorkers.at(-1).terminated), false, "Progress messages must not terminate the worker");
  await expect(live).toHaveAttribute("data-activity-view", "compact", { timeout: 6000 });
  await live.hover();
  await expect(live).toHaveAttribute("data-activity-view", "expanded");
  await live.focus(); await live.press("Escape");
  await expect(live).toHaveAttribute("data-activity-view", "compact");
  await live.focus(); await live.press("Enter");
  await expect(live).toHaveAttribute("data-activity-view", "expanded");
  await page.getByRole("link", { name: "技能Wiki", exact: true }).click();
  await expect(live).toHaveAttribute("data-activity-phase", "running");
  await live.focus();
  await live.getByRole("button", { name: "关闭求解提示", exact: true }).click();
  await expect(live).toHaveCount(0);
  assert.equal(await page.evaluate(() => globalThis.__solverWorkers.at(-1).terminated), false, "Dismissing the notification leaves the solve running");
  await emit({ type: "progress", progress: { stage: "verifying", elapsedMs: 4000 } });
  await expect(live).toHaveCount(0);
  await emit({ type: "result", result });
  await expect(live).toHaveAttribute("data-activity-phase", "success");
  await page.mouse.move(0, 400);
  await expect(live).toHaveCount(0, { timeout: 6500 });

  await page.getByRole("link", { name: "自动排班", exact: true }).click();
  await generate.click();
  await emit({ type: "error", error: "Fixture failure" });
  await expect(live).toHaveAttribute("data-activity-phase", "error");
  await expect(live.getByRole("alert")).toContainText("Fixture failure");
  await expect(page.locator(".ef-page .ef-notice--error")).toHaveCount(0);
  await live.getByRole("button", { name: "重试", exact: true }).click();
  await expect(live).toHaveAttribute("data-activity-phase", "running");
  await emit({ type: "result", result }, -2);
  await expect(live).toHaveAttribute("data-activity-phase", "running");
  await emit({ type: "result", result: { ...result, center: null, rooms: [], scores: {} } });
  await expect(live).toHaveAttribute("data-activity-phase", "error");
  await expect(live).toHaveAttribute("aria-label", "未找到可用方案");
  await expect(page.locator(".ef-schedule-result>.ef-notice")).toHaveCount(0);

  await live.getByRole("button", { name: "重试", exact: true }).click();
  await emit({ type: "result", result: { ...result, verification: { ok: false, errors: ["Invalid crew"] } } });
  await expect(live).toHaveAttribute("aria-label", "方案校验未通过");
  await expect(live.getByRole("alert")).toContainText("Invalid crew");
  await expect(page.locator(".ef-page .ef-notice--error")).toHaveCount(0);
  await page.getByRole("button", { name: "详细报告", exact: true }).click();
  const report = page.getByRole("dialog", { name: "排班报告", exact: true });
  await expect(report.getByRole("alert")).toContainText("Invalid crew");
  await report.getByRole("button", { name: "完成", exact: true }).click();

  await live.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByRole("button", { name: "编辑名单", exact: true }).click();
  await page.getByRole("button", { name: `拥有${catalog[0].name}`, exact: true }).click();
  await page.getByRole("button", { name: "关闭我的干员", exact: true }).click();
  await expect(live).toHaveCount(0);
  assert.equal(await page.evaluate(() => globalThis.__solverWorkers.at(-1).terminated), true, "Changing the roster cancels the previous solve");
  await emit({ type: "result", result });
  await expect(live).toHaveCount(0);
  await expect(page.locator("[data-schedule-board]")).toHaveCount(0);

  // Manual retry must retain its assignments rather than launching an automatic solve.
  await page.getByRole("link", { name: "手动排班", exact: true }).click();
  await page.waitForFunction(() => globalThis.__solverWorkers.at(-1).request?.assignments && !globalThis.__solverWorkers.at(-1).terminated);
  const assignments = await page.evaluate(() => globalThis.__solverWorkers.at(-1).request.assignments);
  assert.ok(assignments);
  await emit({ type: "error", error: "「中枢」B 班人数不合法" });
  await expect(live.getByRole("alert")).toContainText("「中枢」B 班人数不合法");
  await expect(page.locator(".ef-page .ef-notice--error")).toHaveCount(0);
  const workersBeforeRetry = await page.evaluate(() => globalThis.__solverWorkers.length);
  await live.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(count => globalThis.__solverWorkers.length > count, workersBeforeRetry);
  assert.deepEqual(await page.evaluate(() => globalThis.__solverWorkers.at(-1).request.assignments), assignments);
  await emit({ type: "error", error: "Fixture retry failure" });
  await expect(live).toHaveAttribute("data-activity-kind", "evaluation");
  await page.getByRole("link", { name: "技能Wiki", exact: true }).click();
  await expect(live).toHaveCount(0);
  await emit({ type: "result", result });
  await expect(live).toHaveCount(0);

  // Narrow English/dark layout and reduced motion use the same activity state.
  await context.addCookies([{ name: "riic-endfield-locale", value: "en", url: origin }]);
  await page.evaluate(() => globalThis.localStorage.setItem("riic-color-mode", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin);
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "Generate schedule", exact: true }).click();
  await expect(live).toHaveAttribute("aria-label", "Generating schedule");
  await expect(live).toHaveAttribute("data-activity-view", "expanded");
  const bounds = await live.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, "Mobile activity fits without clipping");
  assert.equal(await live.evaluate(el => globalThis.getComputedStyle(el).colorScheme), "dark");
  await emit({ type: "result", result });
  await expect(live).toHaveAttribute("data-activity-phase", "success");
  await live.getByRole("button", { name: "Dismiss solver notification", exact: true }).click();
  await expect(live).toHaveCount(0);

  // Use the real worker to verify an unsustainable center, dismissal and recovery.
  const realContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (entry === origin) await realContext.route("**/api/auth/get-session**", route => route.fulfill({ json: null }));
  await realContext.addCookies([{ name: "riic-endfield-locale", value: "zh", url: origin }]);
  const recoveryOperator = catalog.find(op => op.skills.some(skill => skill.room === "总控中枢" && skill.effectKey === "MoodRecoveryAll"));
  const manual = manualTemplate(input.options);
  manual[0].a = [recoveryOperator.name];
  manual[0].hour = 23;
  const realInput = { ...input, manual, operators: [{ name: recoveryOperator.name, elite: 4 }, ...input.operators.filter(op => op.name !== recoveryOperator.name)] };
  await realContext.addInitScript(({ origin, key, input }) => {
    if (globalThis.location.origin !== origin || globalThis.sessionStorage.getItem("live-activity-fixture")) return;
    globalThis.localStorage.setItem(key, JSON.stringify(input));
    globalThis.sessionStorage.setItem("live-activity-fixture", "1");
  }, { origin, key: STORAGE_KEY, input: realInput });
  const realPage = await realContext.newPage();
  realPage.on("pageerror", error => errors.push(error.message));
  await realPage.goto(entry);
  await realPage.goto(`${origin}/manual`);
  await realPage.locator('body[data-app-hydrated="true"]').waitFor();
  const realLive = realPage.locator('[data-slot="live-activity"]');
  await expect(realLive).toHaveAttribute("data-activity-phase", "error");
  await expect(realLive.getByRole("alert")).toContainText("中枢 A 段不满足 R ≥ C");
  await expect(realPage.locator(".ef-page .ef-notice--error")).toHaveCount(0);
  await realLive.getByRole("button", { name: "关闭求解提示", exact: true }).click();
  await expect(realLive).toHaveCount(0);
  await expect(realPage.getByRole("alert")).toHaveCount(0);
  await realPage.getByRole("combobox", { name: "换班整点", exact: true }).first().fill("12:00");
  await realPage.getByRole("option", { name: "12:00", exact: true }).click();
  await expect(realPage.locator("[data-manual-assignments]")).toHaveAttribute("data-evaluation-state", "ready");
  const slots = realPage.locator("[data-manual-slot]");
  for (let index = 1; index < 6; index++) {
    await slots.nth(index).click();
    await realPage.getByRole("dialog", { name: "选择干员", exact: true }).locator(`[data-operator-name="${realInput.operators[index].name}"]`).click();
  }
  await expect(realLive).toHaveCount(0);
  await expect(realPage.locator("[data-manual-assignments]")).toHaveAttribute("data-evaluation-state", "ready");
  await expect(realPage.locator("[data-manual-board]")).toBeVisible();
  await expect(realPage.locator('[data-manual-output] [data-animated-value][aria-label="0.00"]')).toHaveCount(0);
  await expect(realPage.locator(".ef-page .ef-notice--error")).toHaveCount(0);
  await realContext.close();
  assert.deepEqual(errors, []);
  console.log("Passed: progress lifecycle, dismissal, retry, stale/cancelled work, solver errors shown only in Live Activity, report diagnostics, real manual validation and recovery, English/dark/mobile/reduced-motion layout.");
} finally {
  await browser.close();
}
