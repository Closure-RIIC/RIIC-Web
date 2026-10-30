import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY, manualTemplate } from "@riic/endfield-solver/model.mjs";
import { SIM_RATES } from "@riic/endfield-solver/simulation.mjs";
import { StepSimulation } from "../apps/endfield/src/step/step-engine.ts";
import { ensureBoostDays, maxBoostDays, roomEffectResolver } from "../apps/endfield/src/step/step-model.ts";

const origin = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("This test is local-only");
const workspace = { version: 1, operators: catalog.map(op => ({ name: op.name, elite: 4 })), options: { ...DEFAULT_OPTIONS } };
let index = 0;
workspace.manual = manualTemplate(workspace.options).map(room => ({ ...room,
  a: Array.from({ length: room.slots }, () => catalog[index++].name), b: Array.from({ length: room.slots }, () => catalog[index++].name) }));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "riic-endfield-locale", value: "zh-CN", url: origin }]);
  await context.addInitScript(({ workspace, key }) => {
    if (!globalThis.sessionStorage.getItem("worker-replay-seeded")) {
      globalThis.localStorage.setItem(key, JSON.stringify(workspace));
      globalThis.localStorage.setItem("riic:endfield:step:v1", JSON.stringify({ version: 2, controls: { startHour: 0, maxHours: 96, sampleSec: 10, speed: 100 }, moods: {}, work: {} }));
      globalThis.sessionStorage.setItem("worker-replay-seeded", "1");
    }
    globalThis.replayWorkers = [];
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.record = { url: String(url), terminated: false, messages: [], requests: [] };
        globalThis.replayWorkers.push(this.record);
        this.addEventListener("message", event => { this.record.messages.push(event.data); globalThis.replayComputing = false; });
      }
      postMessage(message, ...options) {
        this.record.requests.push(message);
        if (message.type === "run") globalThis.replayComputing = true;
        if (globalThis.delayReplay && message.type === "run") setTimeout(() => super.postMessage(message, ...options), 2000);
        else super.postMessage(message, ...options);
      }
      terminate() { this.record.terminated = true; super.terminate(); }
    };
  }, { workspace, key: STORAGE_KEY });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/manual?view=simulation");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await expect(page.locator("#showResultBtn")).toBeEnabled();
  await expect(page.locator("[data-manual-slot]")).toHaveCount(0);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    globalThis.replayGaps = [];
    globalThis.replayComputeGaps = [];
    let last = performance.now();
    globalThis.replayHeartbeat = setInterval(() => {
      const now = performance.now();
      globalThis.replayGaps.push(now - last);
      if (globalThis.replayComputing) globalThis.replayComputeGaps.push(now - last);
      last = now;
    }, 20);
  });
  const started = performance.now();
  await page.locator("#showResultBtn").click();
  await page.locator('[data-step-chart="mood"]').first().waitFor();
  await expect(page.locator("#showResultBtn")).toBeEnabled();
  const clickToChartMs = Math.round(performance.now() - started);
  // Stop measurement before exporting fixture data over CDP: inspector serialization is test work.
  const { gap, computeGap, computeTicks } = await page.evaluate(() => {
    clearInterval(globalThis.replayHeartbeat);
    return { gap: Math.max(...globalThis.replayGaps), computeGap: Math.max(0, ...globalThis.replayComputeGaps), computeTicks: globalThis.replayComputeGaps.length };
  });
  const first = await page.evaluate(() => globalThis.replayWorkers.find(worker => worker.requests.some(request => request.type === "run")));
  const input = first.requests.find(request => request.type === "run").input;
  const result = first.messages.find(message => message.type === "complete");
  const engine = new StepSimulation({ ...input.config, boost: ensureBoostDays(input.config.boost, maxBoostDays(input.options.startHour, input.options.maxHours)) }, roomEffectResolver(input.effects), SIM_RATES, input.options);
  engine.runToEnd();
  assert.deepEqual(result.view.output, engine.snapshot().output);
  assert.deepEqual(result.view.ops, engine.snapshot().ops);
  for (const op of engine.snapshot().ops) {
    const moods = [op.mood, ...engine.snapshot().history.map(point => point.moods[op.name]).filter(value => value !== undefined)];
    assert.deepEqual(result.view.moodRanges[op.name], { minimum: Math.min(...moods), maximum: Math.max(...moods) });
  }
  assert.deepEqual(result.view.history, []);
  assert.ok(result.timeline.history.length < 2000, "dense history is reduced before crossing to the main thread");
  // The regression is synchronous simulation. Measure while the real worker computes;
  // chart layout and CDP fixture export are reported separately from computation responsiveness.
  assert.ok(computeTicks > 0, "the main thread must respond during the real computation");
  assert.ok(computeGap < 500, 'main thread stalled during computation for ' + computeGap + 'ms');
  console.log(JSON.stringify({ scenario: "96h / 10s, 30 operators, 4x CPU slowdown", clickToChartMs, computeHeartbeatGapMs: Math.round(computeGap), maxHeartbeatGapMs: Math.round(gap), chartSamples: result.timeline.history.length }));
  await page.locator("summary", { hasText: "事件日志与模拟统计" }).click();
  await expect(page.locator("#logList [data-event]")).toHaveCount(Math.min(50, result.view.log.length));
  if (result.view.log.length > 50) {
    await page.getByRole("button", { name: "下一页事件", exact: true }).click();
    await expect(page.locator("#logList [data-event]")).toHaveCount(Math.min(50, result.view.log.length - 50));
    await page.getByRole("button", { name: "上一页事件", exact: true }).click();
  }

  await page.locator('[data-step-chart="mood"] [data-step-chart-seek]').click({ position: { x: 80, y: 30 } });
  await expect.poll(() => page.evaluate(() => globalThis.replayWorkers.flatMap(worker => worker.messages).length)).toBe(2);
  const seek = await page.evaluate(() => { const worker = globalThis.replayWorkers.find(worker => worker.requests.some(request => request.type === "run")); return { request: worker.requests.at(-1), result: worker.messages.at(-1) }; });
  assert.equal(seek.request.type, "seek");
  engine.seekTo(seek.request.seconds);
  assert.deepEqual(seek.result.view.ops, engine.snapshot().ops);
  assert.deepEqual(seek.result.view.output, engine.snapshot().output);
  assert.equal(seek.result.timeline, undefined, "seeking must not copy the full history again");

  await page.locator("#resetBtn").click();
  await expect(page.locator('[data-step-chart="mood"]')).toHaveCount(0);
  await page.evaluate(() => { globalThis.delayReplay = true; });
  await page.locator("#showResultBtn").click();
  await expect(page.locator("#resetBtn")).toContainText("取消模拟");
  await page.locator("#resetBtn").click();
  await page.waitForTimeout(2200);
  await expect(page.locator('[data-step-chart="mood"]')).toHaveCount(0);
  assert.ok(await page.evaluate(() => globalThis.replayWorkers.filter(worker => worker.requests.some(request => request.type === "run")).every(worker => worker.terminated)));

  await page.locator("#showResultBtn").click();
  await page.locator('details').filter({ has: page.locator('summary', { hasText: "模拟设置" }) }).locator('summary').click();
  // Changing inputs must cancel the old task before its delayed message can run.
  await page.locator("#startHour").fill("1");
  await page.waitForTimeout(2200);
  await expect(page.locator('[data-step-chart="mood"]')).toHaveCount(0);
  assert.ok(await page.evaluate(() => globalThis.replayWorkers.filter(worker => worker.requests.some(request => request.type === "run")).every(worker => worker.terminated)));
  await page.evaluate(() => { globalThis.delayReplay = false; });

  let failed = false;
  await page.route(/simulation\.worker.*\.js/, route => { if (!failed) { failed = true; return route.abort(); } return route.continue(); });
  await page.locator("#showResultBtn").click();
  await expect(page.getByText("模拟未能完成，请点击“展示模拟结果”重试。", { exact: true })).toBeVisible();
  await page.locator("#showResultBtn").click();
  await page.locator('[data-step-chart="mood"]').first().waitFor();
  await page.getByRole("tab", { name: "编辑排班", exact: true }).click();
  await expect(page.locator("[data-manual-slot]")).toHaveCount(index);
  assert.deepEqual(await page.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key)).manual, STORAGE_KEY), workspace.manual);
  assert.ok(await page.evaluate(() => globalThis.replayWorkers.filter(worker => worker.requests.some(request => request.type === "run")).every(worker => worker.terminated)), "leaving replay terminates its worker");
  assert.deepEqual(errors, []);
  console.log("Replay worker E2E passed: exact results and seeking; responsive UI; cancellation; stale-input rejection; load failure recovery; unmount cleanup.");
} finally { await browser.close(); }
