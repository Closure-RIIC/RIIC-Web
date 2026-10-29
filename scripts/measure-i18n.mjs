import fs from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { chromium } from "@playwright/test";

// Use independently built baseline/candidate servers; never benchmark live accounts.
const sites = [
  { app: 'arknights', baseline: 'http://127.0.0.1:5197', candidate: 'http://127.0.0.1:5195', cookie: 'riic-locale' },
  { app: 'endfield', baseline: 'http://127.0.0.1:5198', candidate: 'http://127.0.0.1:5196', cookie: 'riic-endfield-locale' },
].filter(site => !process.env.I18N_PERF_APP || site.app === process.env.I18N_PERF_APP);
const output = process.env.I18N_PERF_OUTPUT ?? '.tmp/i18n-performance.json';
const scenarios = process.env.I18N_PERF_SCENARIOS ? JSON.parse(await fs.readFile(process.env.I18N_PERF_SCENARIOS, 'utf8')) : null;
const selected = (name, value) => !process.env[name] || process.env[name] === String(value);
const runs = Number(process.env.I18N_PERF_RUNS ?? 10);
if (!Number.isInteger(runs) || runs < 10) throw new Error('At least ten samples are required');
const browser = await chromium.launch(), sizes = new Map();
let samples = process.env.I18N_PERF_RESUME === '1' ? JSON.parse(await fs.readFile(output, 'utf8')).samples : [];
const labels = { en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文（台灣）' };
const summarize = values => ({median:(values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2,p95:values[Math.ceil(values.length*.95)-1]});
async function startClickTimer(locator) {
  await locator.evaluate(element => element.addEventListener('click', () => { globalThis.__i18nClickAt = globalThis.performance.now(); }, { capture: true, once: true }));
}
async function elapsedClick(page) {
  return page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => resolve(globalThis.performance.now() - globalThis.__i18nClickAt))));
}
async function closeOverlays(page, mobile) {
  await page.keyboard.press('Escape');
  await page.locator('input[type="email"]').waitFor({ state: 'hidden' });
  await page.locator('[data-sidebar-account-menu]').waitFor({ state: 'hidden' });
  if (mobile) {
    await page.keyboard.press('Escape');
    await page.locator('[data-sidebar="sidebar"][data-mobile="true"]').waitFor({ state: 'hidden' });
    await page.locator('[data-sidebar-account-trigger]').waitFor({ state: 'hidden' });
  }
}
async function navigation(page, url, warm) {
  const urls = new Set();
  const onResponse = response => {
    const parsed = new URL(response.url());
    if (parsed.origin === new URL(url).origin && /\.(js|css)$/.test(parsed.pathname)) urls.add(response.url());
  };
  page.on('response', onResponse);
  const response = warm ? await page.reload({waitUntil:'domcontentloaded'}) : await page.goto(url,{waitUntil:'domcontentloaded'});
  if (response.status() !== 200) throw new Error(url + ': ' + response.status());
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  // Session/background polling may never become globally idle. Measure the
  // hydrated document and its loaded JS/CSS at the next painted frame instead.
  await page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
  const timing = await page.evaluate(() => {
    const nav = globalThis.performance.getEntriesByType('navigation')[0];
    const resources = globalThis.performance.getEntriesByType('resource').filter(entry => /\.(js|css)(\?|$)/.test(entry.name) && new globalThis.URL(entry.name).origin === globalThis.location.origin);
    return { ssrMs: nav.responseStart - nav.requestStart, hydrationMs: globalThis.__i18nHydratedAt, domReadyMs: nav.domContentLoadedEventEnd, networkBytes: nav.transferSize + resources.reduce((total, entry) => total + entry.transferSize, 0) };
  });
  page.off('response', onResponse);
  // Compression is offline analysis. Keep its CPU cost outside the timed load.
  const resources = await Promise.all([...urls].map(async url => {
    if (!sizes.has(url)) {
      const asset = await globalThis.fetch(url);
      if (!asset.ok) throw new Error(`Asset analysis failed: ${asset.status} ${url}`);
      const body = Buffer.from(await asset.arrayBuffer());
      sizes.set(url, {raw:body.length,gzip:gzipSync(body).length,brotli:brotliCompressSync(body).length});
    }
    return {url,...sizes.get(url)};
  }));
  const html = await response.body();
  const bootstrap = [...html.toString().matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].reduce((total, match) => total + Buffer.byteLength(match[1]), 0);
  return { ...timing, htmlBytes: html.length, htmlGzip: gzipSync(html).length, inlineBootstrapBytes: bootstrap, resourceFiles: resources.length, assetRaw: resources.reduce((n,r) => n+r.raw,0), assetGzip: resources.reduce((n,r) => n+r.gzip,0), assetBrotli: resources.reduce((n,r) => n+r.brotli,0) };
}
try {
  for (const site of sites) for (const locale of ['zh-CN','en','zh-TW'].filter(value => selected('I18N_PERF_LOCALE', value))) for (const mobile of [false,true].filter(value => selected('I18N_PERF_MOBILE', value))) for (const route of ['/','/manual','/skills'].filter(value => selected('I18N_PERF_ROUTE', value))) for (let run=0;run<runs;run++) {
    // Alternate order to reduce drift; one context per variant gives equal cold caches.
    for (const variant of run%2 ? ['candidate','baseline'] : ['baseline','candidate']) {
      if ((locale==='zh-TW' && variant==='baseline') || !selected('I18N_PERF_VARIANT', variant)) continue;
      const scenario=scenarios?.find(item=>item.app===site.app&&item.locale===locale&&item.mobile===mobile&&item.route===route);
      if(scenarios&&!scenario)continue;
      const measureRoster=route==='/manual'&&(!scenario||scenario.metrics.includes('rosterMs'));
      const measureAccount=route==='/skills'&&(!scenario||scenario.metrics.includes('accountMs'));
      const measureSwitch=variant==='candidate'&&route==='/skills'&&!scenarios;
      const matches = sample => sample.app===site.app && sample.variant===variant && sample.locale===locale && sample.mobile===mobile && sample.route===route && sample.run===run;
      const existing = samples.filter(matches);
      const expected = 2 + (measureRoster?2:0) + (measureAccount?2:0) + (measureSwitch?2:0);
      if (existing.length===expected) continue;
      samples=samples.filter(sample=>!matches(sample));
      const context = await browser.newContext({ viewport: mobile ? {width:390,height:844} : {width:1440,height:1000}, locale:'en-US' });
      await context.addCookies([{ name: site.cookie, value: locale, url: site[variant] }, { name:'sidebar_state', value:'true', url:site[variant] }]);
      await context.addInitScript(() => {
        const observer = new globalThis.MutationObserver(() => { if (globalThis.document.body?.dataset.appHydrated === 'true') { globalThis.__i18nHydratedAt = globalThis.performance.now(); observer.disconnect(); } });
        observer.observe(globalThis.document, {childList:true,subtree:true,attributes:true,attributeFilter:['data-app-hydrated']});
      });
      const page = await context.newPage(); page.setDefaultTimeout(45000);
      for (const warm of [false,true]) samples.push({app:site.app,variant,locale,mobile,route,run,warm,...await navigation(page,site[variant]+route,warm)});
      if (measureRoster) {
        // Opening Arknights' editor requires an account. Refresh only the local
        // client session; navigation measurements above remain anonymous.
        if(site.app==='arknights') {
          await context.route('**/api/auth/get-session**', request => request.fulfill({json:{user:{id:'i18n-perf',name:'i18n-perf',email:'i18n@example.invalid'},session:{expiresAt:'2099-01-01'}}}));
          if(mobile)await page.keyboard.press('Control+b');
          await page.evaluate(() => globalThis.dispatchEvent(new globalThis.Event('focus')));
          await page.waitForFunction(() => globalThis.document.querySelector('[data-sidebar-account-name]')?.textContent==='i18n-perf');
          if(mobile)await closeOverlays(page,mobile);
        }
        for(const cache of ['cold','warm']) {
          const trigger=site.app==='arknights' ? page.getByRole('button',{name:/^(配置 Box [与與][布局佈]+|Configure Box & layout)$/i}).first() : page.locator('[data-roster-edit]').first();
          await startClickTimer(trigger); await trigger.click();
          if(site.app==='arknights') {
            await page.locator('[data-setup-box-content]').waitFor();
            const manual=page.getByRole('tab',{name:/^(手动选择|手動選擇|Manual(?: selection)?)$/i});
            await manual.click();
            await page.locator('[data-manual-operbox-picker]').waitFor();
          } else await page.locator('.ef-roster-dialog .ef-roster-card').first().waitFor();
          samples.push({app:site.app,variant,locale,mobile,route,run,rosterCache:cache,rosterMs:await elapsedClick(page)});
          await page.keyboard.press('Escape');
          await page.locator(site.app==='arknights'?'[data-setup-dialog]':'.ef-roster-dialog').waitFor({state:'hidden'});
        }
      }
      if (measureAccount) for (const cache of ['cold','warm']) {
        const trigger=page.locator('[data-sidebar-account-trigger]');
        if(!await trigger.isVisible())await page.keyboard.press('Control+b');
        await page.locator('[data-sidebar-account-name]').waitFor();
        const direct=await trigger.getAttribute('data-sidebar-sign-in')!==null;
        if(direct)await startClickTimer(trigger);
        await trigger.click();
        if(!direct){const signIn=page.locator('[data-sidebar-sign-in]');await startClickTimer(signIn);await signIn.click();}
        await page.getByRole('dialog').last().locator('input[type="email"]').waitFor();
        samples.push({app:site.app,variant,locale,mobile,route,run,accountCache:cache,accountMs:await elapsedClick(page)});
        await closeOverlays(page, mobile);
      }
      if (measureSwitch) {
        for (const [target,cache] of [[locale==='zh-TW'?'en':'zh-TW','cold'],[locale,'warm']]) {
          const trigger=page.locator('[data-sidebar-account-trigger]');
          if (!await trigger.isVisible()) await page.keyboard.press('Control+b');
          await trigger.click();
          const option=page.getByRole('menuitemradio',{name:labels[target],exact:true});
          await startClickTimer(option);
          await option.click();
          await page.waitForFunction(locale => globalThis.document.documentElement.lang===locale,target);
          samples.push({app:site.app,variant,locale,mobile,route,run,switchCache:cache,switchMs:await elapsedClick(page)});
          await closeOverlays(page, mobile);
        }
      }
      await context.close();
    }
    if(run===runs-1)console.log(JSON.stringify({app:site.app,locale,mobile,route,samples:samples.length}));
  }
} finally {
  await browser.close(); await fs.mkdir('.tmp',{recursive:true});
  const groups=new Map();
  for(const sample of samples){const key=JSON.stringify([sample.app,sample.variant,sample.locale,sample.mobile,sample.route,sample.accountCache?`account-${sample.accountCache}`:sample.rosterCache?`roster-${sample.rosterCache}`:sample.switchCache??sample.warm]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(sample);}
  const summaries=[...groups].map(([key,items])=>({group:JSON.parse(key),samples:items.length,metrics:Object.fromEntries(['ssrMs','hydrationMs','networkBytes','htmlBytes','htmlGzip','inlineBootstrapBytes','assetRaw','assetGzip','assetBrotli','switchMs','accountMs','rosterMs'].flatMap(metric=>{const values=items.map(item=>item[metric]).filter(Number.isFinite).sort((a,b)=>a-b);return values.length?[[metric,summarize(values)]]:[];}))}));
  await fs.writeFile(output,JSON.stringify({runs,environment:{node:process.version,platform:process.platform,browser:browser.version()},scope:'Local anonymous production pages, first-party JS/CSS + HTML; inline bootstrap is a serialization proxy, not an isolated message-byte count. Timing includes local browser scheduling. Candidate zh-TW pages and switches are measured; baseline has no zh-TW.',samples,summaries},null,2));
}
