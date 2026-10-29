import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY } from "@riic/endfield-solver/model.mjs";

const ak = process.env.ARKNIGHTS_E2E_ORIGIN ?? "http://127.0.0.1:5195";
const ef = process.env.ENDFIELD_E2E_ORIGIN ?? "http://127.0.0.1:5196";
const admin = process.env.ADMIN_E2E_ORIGIN ?? "http://127.0.0.1:5199";
for (const origin of [ak, ef, admin]) if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Local isolated fixtures only");
const browser = await chromium.launch(), results = [], errors = [];
const labels = { "zh-CN": "简体中文", "zh-TW": "繁體中文（台灣）", en: "English" };
const ready = page => page.locator('body[data-app-hydrated="true"]').waitFor();
async function pageFor(origin, cookie) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: cookie, value: 'zh-CN', url: origin }, { name: 'sidebar_state', value: 'true', url: origin }]);
  await context.route('**/api/**', route => route.fulfill({ status: 401, json: { error: { message: 'Isolated fixture' } } }));
  await context.route('**/api/auth/get-session**', route => route.fulfill({ json: null }));
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error' && /MISSING_MESSAGE|INVALID_MESSAGE|hydration|Minified React/.test(event.text())) errors.push(event.text()); });
  return { context, page };
}
async function switchLanguage(page, locale) {
  await page.locator('[data-sidebar-account-trigger]').click();
  await page.getByRole('menuitemradio', { name: labels[locale], exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await page.keyboard.press('Escape');
}
const result = name => { results.push(name); console.log('PASS ' + name); };
try {
  if (process.env.I18N_ADMIN_ONLY !== '1') {
  {
    const { context, page } = await pageFor(ak, 'riic-locale');
    const layout = JSON.parse(await fs.readFile(new URL(import.meta.resolve('@riic/arknights-domain/layouts/243.json')), 'utf8'));
    await context.addInitScript(layout => {
      if (sessionStorage.getItem('manual-seeded')) return;
      sessionStorage.setItem('manual-seeded', '1');
      localStorage.setItem('arknights-infra-calc-beta-onboarding-v1', '1');
      localStorage.setItem('arknights-infra-calc-session-v5', JSON.stringify({ version:5, savedAt:new Date().toISOString(), expiresAt:new Date(Date.now()+86400000).toISOString(), presetLabel:'243', layout,
        operbox:[{id:'char_002_amiya',name:'阿米娅',elite:2,level:80,own:true,potential:6,rarity:5}], sourceName:'i18n local fixture', boxSource:'sample', layoutDirty:false, layoutSource:'local',localLayoutBackup:null,rotationProfile:'abc_12_6_6',fiammettaEnabled:false,result:null,activeShift:0 }));
      localStorage.setItem('arknights-infra-manual-schedule-v1', JSON.stringify({ version:2, activeShift:0, fiammettaEnabled:false, shifts:[{durationHours:24,fiammettaTarget:null,rooms:{trade_1:{operators:['阿米娅',null,null]}}}] }));
    }, layout);
    await page.goto(ak + '/manual'); await ready(page);
    await page.locator('[data-manual-editor-board]').waitFor();
    const before = await page.evaluate(() => ({ draft:localStorage.getItem('arknights-infra-manual-schedule-v1'), box:JSON.parse(localStorage.getItem('arknights-infra-calc-session-v5')).operbox }));
    await switchLanguage(page,'zh-TW'); await switchLanguage(page,'en');
    await expect(page.locator('[data-manual-editor-board]')).toBeVisible();
    const after = await page.evaluate(() => ({ draft:localStorage.getItem('arknights-infra-manual-schedule-v1'), box:JSON.parse(localStorage.getItem('arknights-infra-calc-session-v5')).operbox }));
    assert.deepEqual(after,before);
    result('Manual schedule assignments and selected operator roster survive two switches');
    await page.goto(ak + '/manual?tab=poster'); await ready(page);
    await page.locator('[data-schedule-poster]').waitFor();
    await expect(page.locator('[data-schedule-poster]')).toContainText('rotation');
    const pngDownload = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: /Export.*PNG/i }).click();
    const png = await pngDownload;
    const dimensions = await sharp(await png.path()).metadata();
    assert.equal(dimensions.width, 1920); assert.equal(dimensions.height, 1080);
    assert.match(png.suggestedFilename(), /rotation/);
    result('English schedule poster exports a 1920 × 1080 PNG with a localized filename'); await context.close();
  }
  // Mower's draft effect must not run again when a translation snapshot changes.
  {
    const { context, page } = await pageFor(ak, 'riic-locale');
    await page.goto(ak + '/mower'); await ready(page);
    await page.locator('[data-mower-schedule-page]').waitFor();
    await page.getByRole('button', { name: '排班信息', exact: true }).click();
    await page.getByRole('dialog').locator('input').first().fill('i18n draft survives');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('riic-web-mower-editor-v1'))?.title)).toBe('i18n draft survives');
    const before = await page.evaluate(() => localStorage.getItem('riic-web-mower-editor-v1'));
    await switchLanguage(page, 'zh-TW'); await switchLanguage(page, 'en');
    assert.equal(await page.evaluate(() => localStorage.getItem('riic-web-mower-editor-v1')), before);
    await page.getByRole('button', { name: 'Plan details', exact: true }).click();
    await expect(page.getByRole('dialog').locator('input').first()).toHaveValue('i18n draft survives');
    await page.keyboard.press('Escape');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download plan', exact: true }).click();
    const download = await downloadPromise;
    const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.equal(exported.title, 'i18n draft survives');
    assert.equal(exported.plan1.room_1_1.name, '贸易站');
    result('Mower edited draft and canonical JSON export survive two language switches');
    await context.close();
  }
  {
    const { context, page } = await pageFor(ak, 'riic-locale');
    let polls = 0, submissions = 0;
    await context.route('**/api/tasks/**', route => { polls++; return route.fulfill({ json: { success: true, data: { taskId: 'i18n-pending', status: 'pending', queuePosition: 3, etaSeconds: 5 } } }); });
    await context.route('**/api/tasks', route => { submissions++; return route.fulfill({ status: 500, json: {} }); });
    await context.addInitScript(() => { if (!sessionStorage.getItem('task-seeded')) { localStorage.setItem('aic-plan-task-v1', JSON.stringify({ taskId: 'i18n-pending', savedAt: Date.now() })); sessionStorage.setItem('task-seeded', '1'); } });
    await page.goto(ak); await ready(page); await expect.poll(() => polls).toBeGreaterThan(0);
    const initial = await page.evaluate(() => localStorage.getItem('aic-plan-task-v1'));
    await switchLanguage(page, 'en'); await switchLanguage(page, 'zh-TW');
    assert.equal(await page.evaluate(() => localStorage.getItem('aic-plan-task-v1')), initial);
    assert.equal(submissions, 0);
    result('Pending scheduling task retains identity without resubmission');
    await context.close();
  }
  {
    const { context, page } = await pageFor(ef, 'riic-endfield-locale');
    await context.addInitScript(({ key, workspace }) => { if (!sessionStorage.getItem('workspace-seeded')) { localStorage.setItem(key, JSON.stringify(workspace)); sessionStorage.setItem('workspace-seeded', '1'); } }, { key: STORAGE_KEY, workspace: { version: 1, operators: catalog.slice(0, 8).map(op => ({ name: op.name, elite: 4 })), options: DEFAULT_OPTIONS } });
    await page.goto(ef); await ready(page);
    const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    await switchLanguage(page, 'zh-TW'); await switchLanguage(page, 'en');
    const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    assert.deepEqual(after.operators, before.operators); assert.deepEqual(after.options, before.options);
    result('Endfield roster and production configuration retain canonical values');
    await context.close();
  }
  // Explicitly delayed chunks exercise pending/atomic switching, independently of failure/retry.
  for (const [origin, cookie] of [[ak, 'riic-locale'], [ef, 'riic-endfield-locale']]) {
    const { context, page } = await pageFor(origin, cookie);
    await page.goto(origin + '/skills'); await ready(page);
    const input = page.locator('main input[type="text"], main input[type="search"], [data-skill-query-page] input').first();
    await input.fill('preserved query');
    let release; const gate = new Promise(resolve => { release = resolve; }); let blocked = 0;
    await context.route('**/*.js', async route => { blocked++; await gate; await route.continue(); });
    await page.locator('[data-sidebar-account-trigger]').click();
    await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
    await expect.poll(() => blocked).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('menuitemradio', { name: '繁體中文（台灣）', exact: true })).toBeDisabled();
    release(); await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.keyboard.press('Escape'); await expect(input).toHaveValue('preserved query');
    result(origin + ' delayed resources switch atomically and preserve input'); await context.close();
  }
  for (const [origin, cookie] of [[ak, 'riic-locale'], [ef, 'riic-endfield-locale']]) {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => {
      const locale = ['zh-CN', 'zh-TW', 'en'][i % 3];
      return fetch(origin + '/skills', { headers: { Cookie: cookie + '=' + locale } }).then(async response => {
        assert.equal(response.status, 200); assert.match(await response.text(), new RegExp(`<html[^>]*lang="${locale}"`));
      });
    })); assert.equal(responses.length, 12); result(origin + ' concurrent SSR locale isolation');
  }
  }
  if (process.env.I18N_SKIP_ADMIN !== '1') {
    const { context, page } = await pageFor(admin, 'riic-locale');
    page.setDefaultTimeout(120000);
    for (const locale of ['zh-CN', 'zh-TW', 'en']) {
      await context.addCookies([{ name: 'riic-locale', value: locale, url: admin }]);
      for (const route of ['', '/users', '/issues', '/quality', '/skills', '/changelog']) {
        const response = await page.goto(admin + '/admin-preview' + route, { waitUntil: 'domcontentloaded' }); assert.equal(response.status(), 200); await ready(page);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('main').first()).toBeVisible({ timeout: 120000 });
        console.log(`Admin fixture ${locale} ${route || '/'} ready`);
      }
    }
    result('Isolated development administrator fixture: six routes in three languages'); await context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await fs.mkdir('.tmp', { recursive: true }); await fs.writeFile(process.env.I18N_ADMIN_ONLY === '1' ? '.tmp/i18n-admin-e2e-results.json' : '.tmp/i18n-state-e2e-results.json', JSON.stringify({ results, errors }, null, 2)); }
