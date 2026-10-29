import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { DEFAULT_OPTIONS, STORAGE_KEY, manualTemplate, evaluateManual } from "@riic/endfield-solver/index.mjs";
import { RESULT_STORAGE_KEY, encodeResultCache } from "../apps/endfield/src/result-cache.ts";

const origin = process.env.ENDFIELD_E2E_ORIGIN ?? "http://127.0.0.1:5196";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local isolated fixtures only");
const workspace = { version: 1, operators: [{ name: "佩丽卡", elite: 4 }, { name: "陈千语", elite: 4 }], options: { ...DEFAULT_OPTIONS, assist: false } };
workspace.manual = manualTemplate(workspace.options);
const guest = workspace.manual.find(room => room.key === "会客室");
guest.a[0] = "佩丽卡"; guest.b[0] = "陈千语";
const result = evaluateManual(workspace, workspace.manual);
assert.equal(result.verification.ok, true);
result.elapsedMs = 1180;
result.status.approximations = ["同类双设施缺少稳定实例，按上界估计"];
const cache = encodeResultCache(workspace, result);
assert.ok(cache);
const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "riic-endfield-locale", value: "zh-CN", url: origin }, { name: "sidebar_state", value: "true", url: origin }]);
  await context.route("**/api/**", route => route.fulfill({ status: 401, json: { success: false, error: { code: "AIC-AUTH-2008", message: "untranslated server fixture" } } }));
  await context.route("**/api/auth/get-session**", route => route.fulfill({ json: null }));
  await context.addInitScript(({ workspace, cache, key, resultKey }) => {
    if (sessionStorage.getItem("report-seeded")) return;
    localStorage.setItem(key, JSON.stringify(workspace));
    localStorage.setItem(resultKey, cache);
    sessionStorage.setItem("report-seeded", "1");
  }, { workspace, cache, key: STORAGE_KEY, resultKey: RESULT_STORAGE_KEY });
  const page = await context.newPage();
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(120000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error" && /MISSING_MESSAGE|INVALID_MESSAGE|hydration/.test(event.text())) errors.push(event.text()); });
  await page.goto(origin); await page.locator('body[data-app-hydrated="true"]').waitFor();
  const status = page.locator(".ef-result-status"), board = page.locator("[data-schedule-board]");
  await expect(status).toContainText("1 项提示");
  assert.equal(await status.count(), 1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const timing = await page.locator(".ef-result-timing").boundingBox();
    const notice = await status.boundingBox();
    const facilities = await board.boundingBox();
    assert.ok(timing && notice && facilities);
    if (width > 900) {
      assert.ok(notice.x >= timing.x + timing.width, "desktop status follows the cycle duration");
      assert.ok(notice.y < facilities.y, "desktop status is above the facility cards");
    } else assert.ok(notice.y >= facilities.y + facilities.height, "mobile status stays below the facility cards");
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false, "no page overflow");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  async function switchLanguage(locale, label) {
    await page.locator("[data-sidebar-account-trigger]").click();
    await page.getByRole("menuitemradio", { name: label, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.keyboard.press("Escape");
  }
  await switchLanguage("zh-TW", "繁體中文（台灣）");
  await expect(status).not.toContainText("校验");
  await switchLanguage("en", "English");
  await expect(status).not.toContainText(/\p{Script=Han}/u);
  await page.getByRole("button", { name: "Full report", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("upper-bound estimate");
  await expect(page.getByRole("dialog")).not.toContainText(/\p{Script=Han}/u);
  console.log("PASS: desktop/mobile status placement and trilingual cached report");
  await page.keyboard.press("Escape");
  await page.goto(origin + "/manual?view=simulation"); await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "Show results", exact: true }).click();
  await expect(page.locator("#logList")).toContainText("Simulation started");
  await expect(page.locator("#logList")).not.toContainText(/\p{Script=Han}/u);
  const count = await page.locator(".ef-step-log-entry").count();
  await switchLanguage("zh-TW", "繁體中文（台灣）");
  await expect(page.locator(".ef-step-log-entry")).toHaveCount(count);
  await expect(page.locator("#logList")).toContainText("模擬");
  console.log("PASS: existing simulation logs follow language changes");
  await switchLanguage("en", "English");
  await page.goto(origin + "/skland"); await page.locator('body[data-app-hydrated="true"]').waitFor();
  await expect(page.getByText("Sign in to your RIIC website account first.", { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log("PASS: desktop/mobile report placement, trilingual cached report, simulation language switching, localized API errors");
} finally { await browser.close(); }
