import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY, solve } from "../packages/endfield-solver/index.mjs";

const origin = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local preview only");
const input = {
  version: 1, operators: catalog.slice(0, 8).map(op => ({ name: op.name, elite: 0 })),
  options: { ...DEFAULT_OPTIONS, levels: { center: 1, mfg1: 1, mfg2: 1, grow: 0, guest: 0 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 }, time: 30000, budget: 10000 },
};
const result = solve(input);
assert.ok(result.center && result.verification.ok);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("**/api/auth/get-session**", route => route.fulfill({ contentType: "application/json", body: "null" }));
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
  await page.goto(origin);
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
  await page.getByRole("link", { name: "技能查询", exact: true }).click();
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
  await live.getByRole("button", { name: "重试", exact: true }).click();
  await expect(live).toHaveAttribute("data-activity-phase", "running");
  await emit({ type: "result", result }, -2);
  await expect(live).toHaveAttribute("data-activity-phase", "running");
  await emit({ type: "result", result: { ...result, center: null, rooms: [], scores: {} } });
  await expect(live).toHaveAttribute("data-activity-phase", "error");
  await expect(live).toHaveAttribute("aria-label", "未找到可用方案");

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
  await page.getByRole("button", { name: "评估方案", exact: true }).click();
  const assignments = await page.evaluate(() => globalThis.__solverWorkers.at(-1).request.assignments);
  assert.ok(assignments);
  await emit({ type: "error", error: "Manual fixture failure" });
  await live.getByRole("button", { name: "重试", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => globalThis.__solverWorkers.at(-1).request.assignments), assignments);
  await expect(live).toHaveAttribute("data-activity-kind", "manual");
  await page.getByRole("button", { name: "取消", exact: true }).click();
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
  assert.deepEqual(errors, []);
  console.log("Passed: progress lifecycle, compact/expanded interactions, navigation, dismissal, success timeout, error retry, stale/cancelled work, manual retry and English/dark/mobile/reduced-motion layout.");
} finally {
  await browser.close();
}
