/* global process, console, URL */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const origin = process.env.ARKNIGHTS_E2E_ORIGIN || "http://127.0.0.1:5175";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local-only test");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "riic-locale", value: "zh", url: origin }]);
  await context.route("**/api/auth/get-session**", route => route.fulfill({ contentType: "application/json", body: "null" }));
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/training-plan`);
  await page.getByRole("button", { name: "添加干员", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  const search = dialog.locator("[data-search-input]");
  await search.fill("能天使");
  assert.equal(await search.inputValue(), "能天使");
  await dialog.getByRole("button", { name: /能天使/ }).first().waitFor();
  await search.fill("no-matching-operator-123");
  assert.equal(await dialog.getByRole("button", { name: /能天使/ }).count(), 0);
  await dialog.getByRole("button", { name: "清空搜索", exact: true }).click();
  assert.equal(await search.inputValue(), "");
  const six = dialog.getByRole("tab", { name: /6/ });
  await six.click();
  assert.equal(await six.getAttribute("aria-selected"), "true");
  await six.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await six.evaluate(el => el === globalThis.document.activeElement), false, "Arrow keys move focus");
  await page.keyboard.press("Enter");
  const selected = dialog.locator('[role="tab"][aria-selected="true"]');
  assert.ok(await selected.count() > 0);
  assert.notEqual(await six.getAttribute("aria-selected"), "true", "Enter activates the focused rarity tab");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.goto(`${origin}/skills`);
  await page.locator('[data-workbench-hydrated="true"]').waitFor();
  const skillSearch = page.locator("[data-skill-query-page] [data-search-input]");
  await skillSearch.fill("能天使");
  assert.equal(Math.round((await skillSearch.boundingBox()).height), 44, "Shared search keeps the skill page's original height");
  await page.locator("[data-skill-query-page]").getByRole("button", { name: /清空搜索/ }).click();
  assert.equal(await skillSearch.inputValue(), "");
  assert.equal(await skillSearch.evaluate(el => el === globalThis.document.activeElement), true, "Clearing returns focus to the search input");
  assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
  assert.deepEqual(errors, []);
  console.log("Passed: Arknights shared operator search, skill search and clear/focus, rarity tabs, keyboard navigation, mobile width and dialog dismissal. Isolated local context.");
} finally {
  await browser.close();
}
