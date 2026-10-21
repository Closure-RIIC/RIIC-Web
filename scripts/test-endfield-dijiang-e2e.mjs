import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY } from "../packages/endfield-solver/model.mjs";

const origin = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local-only test");
const sourceIndex = process.argv.indexOf("--anatomy");
const lineCheck = sourceIndex < 0 ? null : (await import(pathToFileURL(join(resolve(process.argv[sourceIndex + 1]), "scripts/line-ends.mjs")))).LINE_ENDS;
const output = resolve("test-results/endfield-dijiang");
await mkdir(output, { recursive: true });
const workspace = { version: 1, operators: catalog.map(op => ({ name: op.name, elite: 4 })), options: DEFAULT_OPTIONS };
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "riic-endfield-locale", value: "zh", url: origin }, { name: "sidebar_state", value: "true", url: origin }]);
  await context.route("**/api/**", route => route.fulfill({ status: 401, json: { error: "Isolated fixture" } }));
  await context.route("**/api/auth/get-session**", route => route.fulfill({ json: null }));
  await context.addInitScript(({ key, workspace }) => {
    if (!globalThis.sessionStorage.getItem("fixture-seeded")) {
      globalThis.localStorage.setItem(key, JSON.stringify(workspace));
      globalThis.sessionStorage.setItem("fixture-seeded", "true");
    }
  }, { key: STORAGE_KEY, workspace });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  const board = page.locator("[data-schedule-board]"), backdrop = board.locator(".ef-dijiang");
  const scheduleText = () => board.locator("[data-facility]").allTextContents();
  await expect(board.locator("[data-facility]")).toHaveCount(5);
  await expect(backdrop).toHaveCount(0);
  const originalResultText = await scheduleText();
  await page.locator("[data-sidebar-settings-trigger]").click();
  const backdropPreference = page.getByRole("checkbox", { name: /显示帝江号背景/ });
  await expect(backdropPreference).not.toBeChecked();
  await backdropPreference.check();
  await page.getByRole("link", { name: "自动排班", exact: true }).click();
  assert.deepEqual(await scheduleText(), originalResultText, "Enabling the backdrop preserves the schedule");
  await expect(backdrop).toHaveAttribute("data-running", "true");
  await expect(backdrop).toHaveAttribute("aria-hidden", "true");
  assert.equal(await backdrop.locator("button, a, input, [tabindex]").count(), 0);
  for (const part of ["engineering.body", "command.spire", "command.tower"]) {
    await expect(backdrop.locator(`[data-dijiang-part="${part}"]`)).toHaveCount(1);
  }
  assert.ok(await backdrop.locator('[data-dijiang-part^="frame.rail."]').count() >= 4);
  await expect(backdrop.locator(".ef-dijiang-rotor")).toHaveCount(0);
  assert.equal(await board.evaluate(el => globalThis.getComputedStyle(el, "::before").content), "none");
  await expect(backdrop).toHaveCSS("pointer-events", "none");
  const signal = backdrop.locator(".ef-dijiang-status").first();
  const pose = () => signal.evaluate(el => globalThis.getComputedStyle(el).opacity);
  const firstPose = await pose();
  await expect.poll(pose).not.toEqual(firstPose);
  const vessel = backdrop.locator(".ef-dijiang-vessel");
  const checkHullFits = async () => {
    const geometry = await backdrop.evaluate(el => {
      const svg = el.querySelector("[data-dijiang-artwork]");
      const b = svg.getBBox(), matrix = svg.getScreenCTM(), board = el.getBoundingClientRect();
      const left = new globalThis.DOMPoint(b.x,b.y).matrixTransform(matrix).x;
      const right = new globalThis.DOMPoint(b.x+b.width,b.y).matrixTransform(matrix).x;
      return {left,right,start:board.left,end:board.right};
    });
    assert.ok(geometry.left >= geometry.start + 8 && geometry.right <= geometry.end - 8,
      `Both ends of the right-shifted hull remain visible: ${JSON.stringify(geometry)}`);
  };
  await checkHullFits();
  const core = backdrop.locator('[data-dijiang-core]');
  await expect(core.locator('[data-name^="protorig.facet."]')).toHaveCount(40);
  const corePose = () => core.locator('[data-name="protorig.core"] [data-r="fill"]').getAttribute("d");
  const firstCorePose = await corePose();
  const hull = backdrop.locator('[data-dijiang-part="engineering.body"]');
  const firstPosition = await hull.boundingBox();
  await expect.poll(corePose, {message:"Only the enclosed mineral rotates in 3D"}).not.toEqual(firstCorePose);
  assert.deepEqual(await hull.boundingBox(), firstPosition, "The hull remains stationary");
  await expect(vessel).toHaveCSS("animation-name", "none");
  const resultText = await scheduleText();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => {
      globalThis.localStorage.setItem("riic-color-mode", theme);
      globalThis.dispatchEvent(new Event("focus"));
    }, theme);
    await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
    await page.screenshot({ path: join(output, `desktop-${theme}.png`) });
    const bounds = await board.boundingBox();
    assert.ok(bounds.y + bounds.height < 900, "The backdrop adds no height to the result board");
    assert.deepEqual(await scheduleText(), resultText, "Animation/theme changes do not alter result data");
    assert.ok(await board.locator("[data-facility]").first().evaluate(el => {
      const b = el.getBoundingClientRect();
      return el.contains(globalThis.document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
    }), "The artwork never captures pointer events over a result card");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(backdrop).toHaveAttribute("data-running", "false");
  await expect(signal).toHaveCSS("animation-name", "none");
  await expect(vessel).toHaveCSS("animation-name", "none");
  const stoppedPose = await corePose();
  await page.waitForTimeout(160);
  assert.equal(await corePose(), stoppedPose, "Reduced motion also stops the 3D renderer");
  const orbit = await page.evaluate(() => {
    const turn = globalThis.__isoTurn, samples = [];
    let forced = 0, unseparated = 0;
    const before = turn.get();
    for (let angle = 0; angle < 360; angle += 2) {
      const start = globalThis.performance.now();
      turn.set({ protorig: angle });
      samples.push(globalThis.performance.now() - start);
      forced += turn.stats().forced;
      unseparated += turn.stats().unseparated;
    }
    turn.set(before);
    samples.sort((a,b)=>a-b);
    return { forced, unseparated, medianMs: samples[90], p95Ms: samples[171] };
  });
  assert.equal(orbit.forced, 0, "No ambiguous paint order across a complete rotation");
  assert.equal(orbit.unseparated, 0, "No intersecting crystal parts across a complete rotation");
  console.log(`Core rotation, 180 browser poses: ${JSON.stringify(orbit)}`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(backdrop).toHaveAttribute("data-running", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-app-scroll-area]").evaluate(el => { el.scrollTop = 0; });
  await expect(backdrop).toHaveAttribute("data-running", "false");
  const offscreenPose = await corePose();
  await page.waitForTimeout(160);
  assert.equal(await corePose(), offscreenPose, "Offscreen geometry stops updating");
  await backdrop.scrollIntoViewIfNeeded();
  await expect(backdrop).toHaveAttribute("data-running", "true");
  await checkHullFits();
  await expect.poll(corePose).not.toEqual(offscreenPose);
  assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
  await page.screenshot({ path: join(output, "mobile.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("[data-sidebar-settings-trigger]").click();
  await expect(page.locator(".ef-dijiang")).toHaveCount(0);
  await expect(backdropPreference).toBeChecked();
  await backdropPreference.uncheck();
  await page.getByRole("link", { name: "自动排班", exact: true }).click();
  await expect(backdrop).toHaveCount(0);
  await page.reload();
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await expect(board.locator("[data-facility]")).toHaveCount(5);
  await expect(backdrop).toHaveCount(0);
  assert.deepEqual(await scheduleText(), resultText, "Disabling the backdrop survives reload and preserves the schedule");
  await page.locator("[data-sidebar-settings-trigger]").click();
  await backdropPreference.check();
  await page.getByRole("link", { name: "自动排班", exact: true }).click();
  await expect(backdrop).toHaveAttribute("data-running", "true");
  assert.deepEqual(await scheduleText(), resultText, "Returning to the page restores the same schedule and animation");
  assert.deepEqual(errors, [], "No runtime or hydration errors");

  // Inspect the generated geometry at 4× separately from the overlaid result cards.
  const artwork = await readFile(new URL("../apps/endfield/src/components/dijiang-artwork.svg", import.meta.url), "utf8");
  const styles = await readFile(new URL("../apps/endfield/src/components/dijiang-backdrop.css", import.meta.url), "utf8");
  const turnStyles = await readFile(new URL("../apps/endfield/src/components/dijiang-turn.css", import.meta.url), "utf8");
  const illustrationContext = await browser.newContext({ viewport: { width: 1120, height: 580 }, deviceScaleFactor: 4, reducedMotion: "reduce" });
  const illustration = await illustrationContext.newPage();
  for (const theme of ["light", "dark"]) {
    await illustration.setContent(`<html class="${theme}"><head><style>${turnStyles}\n${styles}
      body{margin:0;background:${theme === "dark" ? "#17191b" : "#fff"}}
      .ef-dijiang{opacity:1!important;position:relative;top:0;translate:none;width:1120px;height:580px}
      </style></head><body><div class="ef-dijiang">${artwork}</div></body></html>`);
    if (lineCheck) {
      const result = await illustration.evaluate(`(${lineCheck})({select:".ef-dijiang"})`);
      assert.equal(result.problems.length, 0, JSON.stringify(result.problems));
      console.log(`Anatomy ${theme}: line ends ${result.problems.length}, ${result.lines} lines checked.`);
    }
    await illustration.screenshot({ path: join(output, `geometry-${theme}-4x.png`) });
    for (const [region,clip] of [
      ["aft", { x:0,y:270,width:370,height:280 }],
      ["frame", { x:350,y:180,width:370,height:280 }],
      ["command", { x:700,y:30,width:420,height:370 }],
    ]) {
      await illustration.screenshot({path:join(output,`${region}-${theme}-4x.png`),clip});
    }
  }
  await illustrationContext.close();
  await context.close();
  console.log("Passed: Dijiang backdrop, real solve, theme/readability layering, continuous motion, reduced motion, offscreen pause, route cleanup/restore and mobile layout.");
} finally {
  await browser.close();
}
