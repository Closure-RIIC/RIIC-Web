import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const sites = [
  { app: "arknights", origin: process.env.ARKNIGHTS_E2E_ORIGIN ?? "http://127.0.0.1:5195", cookie: "riic-locale" },
  { app: "endfield", origin: process.env.ENDFIELD_E2E_ORIGIN ?? "http://127.0.0.1:5196", cookie: "riic-endfield-locale" },
].filter(site => !process.env.I18N_E2E_APP || site.app === process.env.I18N_E2E_APP);
if (!sites.length) throw new Error('I18N_E2E_APP must be arknights or endfield');
for (const site of sites) if (!["localhost", "127.0.0.1"].includes(new URL(site.origin).hostname)) throw new Error("Internationalization E2E only permits local fixture servers.");
const locales = ["zh-CN", "zh-TW", "en"], labels = { "zh-CN": "简体中文", "zh-TW": "繁體中文（台灣）", en: "English" };
const results = [], browser = await chromium.launch({ headless: true });
const hydrated = page => page.locator('body[data-app-hydrated="true"]').waitFor();
async function menu(page) {
  const trigger = page.locator('[data-sidebar-account-trigger]');
  if (!await trigger.isVisible()) await page.keyboard.press('Control+b');
  await trigger.click();
  await page.locator('[data-sidebar-language-switch]').waitFor();
}
async function choose(page, locale) {
  await page.getByRole('menuitemradio', { name: labels[locale], exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}
async function closeMenus(page, mobile) {
  await page.keyboard.press('Escape');
  if (mobile) await page.keyboard.press('Escape');
}
try {
  for (const site of sites) for (const locale of locales) for (const mobile of [false, true]) for (const signedIn of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, locale: 'en-US' });
    await context.addCookies([{ name: site.cookie, value: locale, url: site.origin }, { name: 'sidebar_state', value: 'true', url: site.origin }]);
    // The server starts anonymously; a refresh uses an isolated ordinary-user fixture.
    await context.route('**/api/**', route => route.fulfill({ status: 401, json: { error: { message: 'Isolated i18n fixture' } } }));
    await context.route('**/api/auth/get-session**', route => route.fulfill({ json: signedIn ? { user: { id: 'i18n-fixture', name: 'i18n-fixture', email: 'i18n@example.invalid' }, session: { expiresAt: '2099-01-01' } } : null }));
    await context.route('**/api/account/feature-access', route => route.fulfill({ json: { agent: false, billing: false } }));
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
    page.on('console', event => { if (event.type() === 'error' && !event.text().startsWith('Failed to load resource:')) { console.error(event.text()); errors.push(event.text()); } });
    const response = await page.goto(`${site.origin}/skills`);
    assert.equal(response.status(), 200);
    assert.match(await response.text(), new RegExp(`<html[^>]*lang="${locale}"`));
    await hydrated(page);
    if (signedIn) {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      if (mobile) await page.keyboard.press('Control+b');
      await expect(page.locator('[data-sidebar-account-name]').first()).toHaveText('i18n-fixture');
      if (mobile) { await page.keyboard.press('Escape'); await page.locator('[data-sidebar-account-trigger]').waitFor({ state: 'hidden' }); }
    }
    const input = page.locator('main input[type="text"], main input[type="search"], [data-skill-query-page] input').first();
    await input.fill('amiya');
    // Endfield persists its initial default workspace after hydration; capture the
    // baseline after that write, so initialization is not mistaken for lost state.
    if (site.app === 'endfield') await expect.poll(() => page.evaluate(() => localStorage.getItem('riic:endfield:workspace:v1'))).not.toBe(null);
    const draft = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /workspace|manual|mower|operbox/i.test(key))));
    await menu(page);
    const target = locales[(locales.indexOf(locale) + 1) % locales.length];
    await choose(page, target);
    await closeMenus(page, mobile);
    await expect(input).toHaveValue('amiya');
    assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /workspace|manual|mower|operbox/i.test(key)))), draft);
    assert.equal((await context.cookies()).find(cookie => cookie.name === site.cookie)?.value, target);
    await page.reload(); await hydrated(page);
    await expect(page.locator('html')).toHaveAttribute('lang', target);
    if (!mobile) {
      await page.locator('[data-game-switcher]').click();
      const destination = page.locator('[role="menu"] a[href]').filter({ hasNot: page.locator('[aria-current="true"]') });
      const links = await destination.evaluateAll(elements => elements.map(element => element.href));
      assert.ok(links.some(href => new URL(href).searchParams.get('ui_locale') === target), 'Cross-site navigation carries the selected locale');
      await page.keyboard.press('Escape');
    }
    if (!signedIn) {
      await menu(page);
      await page.locator('[data-sidebar-sign-in]').click();
      const dialog = page.getByRole('dialog').last();
      await expect(dialog).toBeVisible();
      const email = dialog.locator('input[type="email"]');
      await expect(email).toBeVisible();
      await email.fill('i18n-fixture@example.invalid');
      await expect(email).toHaveValue('i18n-fixture@example.invalid');
      assert.ok(!/MISSING_MESSAGE|INVALID_MESSAGE|Account\.[A-Z]/.test(await dialog.innerText()));
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, [], `${site.app} ${locale} mobile=${mobile} signedIn=${signedIn}`);
    results.push({ app: site.app, locale, target, mobile, signedIn, passed: true });
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  for (const site of sites) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    await page.goto(`${site.origin}/skills`); await hydrated(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    const input = page.locator('main input[type="text"], main input[type="search"], [data-skill-query-page] input').first();
    await input.fill('state survives');
    let fail = true, intercepted = 0;
    await context.route('**/*.js', route => { if (fail) { intercepted++; return route.abort(); } return route.continue(); });
    await menu(page);
    await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
    await expect(page.locator('[data-sidebar-account-menu] [role="alert"]').filter({ hasText: '语言加载失败' })).toBeVisible();
    assert.ok(intercepted > 0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(input).toHaveValue('state survives');
    fail = false;
    await choose(page, 'en');
    await closeMenus(page, false);
    await expect(input).toHaveValue('state survives');
    const response = await page.goto(`${site.origin}/skills?ui_locale=zh-TW&keep=1#filters`);
    assert.match(await response.text(), /<html[^>]*lang="zh-TW"/);
    await hydrated(page);
    await expect(page).toHaveURL(`${site.origin}/skills?keep=1#filters`);
    assert.equal((await context.cookies()).find(cookie => cookie.name === site.cookie)?.value, 'zh-TW');
    results.push({ app: site.app, defaultLocale: true, failureRetry: true, explicitLocale: true, passed: true });
    console.log(JSON.stringify(results.at(-1))); await context.close();
  }
  if (sites.some(site => site.app === 'arknights')) {
    const site = sites.find(site => site.app === 'arknights'), context = await browser.newContext({ locale: 'en-US' });
    await context.addInitScript(() => localStorage.setItem('infra-demo-locale', 'zh-Hant'));
    const page = await context.newPage();
    const response = await page.goto(`${site.origin}/skills`);
    assert.match(await response.text(), /<html[^>]*lang="zh-CN"/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('infra-demo-locale'))).toBe(null);
    assert.equal((await context.cookies()).find(cookie => cookie.name === site.cookie)?.value, 'zh-TW');
    results.push({ app: site.app, legacyPreferenceMigration: true, passed: true });
    await context.close();
  }
} finally {
  await browser.close();
  await fs.mkdir('.tmp', { recursive: true });
  await fs.writeFile('.tmp/i18n-e2e-results.json', JSON.stringify(results, null, 2) + '\n');
}
