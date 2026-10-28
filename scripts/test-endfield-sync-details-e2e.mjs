import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// Loopback-only account fixtures exercise public pages and authenticated synchronization.
const account = createServer((request, response) => {
  if (!(request.headers.cookie ?? '').includes('better-auth.session_token=sync-fixture')) { response.writeHead(403).end(); return; }
  if (request.url.startsWith('/api/platform/endfield-access')) { response.writeHead(204).end(); return; }
  const value = request.url.startsWith('/api/auth/get-session')
    ? {user:{id:'sync-fixture',name:'Sync test',email:'sync@example.invalid'},session:{expiresAt:'2099-01-01T00:00:00.000Z'}}
    : {agent:false,billing:false};
  response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value));
});
await new Promise(resolve => account.listen(0,'127.0.0.1',resolve));
const probe = createServer();
await new Promise(resolve => probe.listen(0,'127.0.0.1',resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const env = {...process.env, NODE_ENV:"development", ENDFIELD_ACCOUNT_ORIGIN:`http://127.0.0.1:${account.address().port}`};
delete env.ENDFIELD_LOCAL_PREVIEW;
delete env.PLATFORM_API_ORIGIN;
const vite = spawn(process.execPath,['scripts/run-vite.mjs','endfield','dev','--host','127.0.0.1','--port',String(port),'--strictPort'],{env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
const exited = once(vite,'exit');
let log = '';
for (const stream of [vite.stdout,vite.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-10000); });
let browser;
try {
  let ready = false;
  for (let attempt=0; attempt<120; attempt++) {
    if (vite.exitCode !== null) throw new Error(log);
    try { const response=await fetch(origin,{signal:AbortSignal.timeout(1000)}); assert.equal(response.status,200,'Public pages load without a website session'); ready=true; break; } catch { await delay(250); }
  }
  assert.ok(ready, log);
  const screenshotDirectory = path.resolve(process.env.ENDFIELD_SYNC_SCREENSHOT_DIR || '.tmp/endfield-sync-details-e2e');
  await mkdir(screenshotDirectory,{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1360,height:1000}});
 await page.context().addCookies([{name:'better-auth.session_token',value:'sync-fixture',url:origin}]);
 let syncCalls=0;
 let progressOverride=null;
 const role={uid:'fixture',roleId:'role-a',serverId:'server-a',nickname:'同步测试账号',serverName:'测试服务器',isDefault:true};
 const character=(id,name,elite,nodes=[])=>({id,name,elite,level:50,latestSpaceshipSkillNodes:nodes});
 const base={game:'endfield',role:{roleId:'role-a',name:'同步测试账号',serverName:'测试服务器',level:40},rosterComplete:true,facilitiesComplete:true,fetchedAt:Date.now(),characters:[character('chr_0004_pelica','佩丽卡',1,['spaceship_skill_chr_0004_pelica_1_1']),character('chr_0005_chen','陈千语',2),character('chr_9000_endmin','管理员',2)],rooms:[{id:'c',type:0,level:5},{id:'m1',type:1,level:3},{id:'m2',type:1,level:3},{id:'g',type:2,level:2},{id:'r',type:5,level:3}]};
 base.details={base:{level:40},dungeon:{curStamina:90,maxStamina:240},bpSystem:{curLevel:0,maxLevel:60},dailyMission:{dailyActivation:75,maxDailyActivation:100}};
 const changed=structuredClone(base);changed.details.dungeon.curStamina=260;changed.details.bpSystem.curLevel=60;changed.characters=[character('chr_0004_pelica','佩丽卡',3,['spaceship_skill_chr_0004_pelica_1_2']),character('chr_0006_wolfgd','狼卫',1),character('chr_9000_endmin','管理员',2)];changed.rooms.find(r=>r.type===2).level=3;
 await page.route('**/api/skland/**',route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1);
  const data=action==='accounts'?{ownerKey:'fixture-owner',accounts:[{id:'fixture-account',label:'同步测试账号',source:'endfield'}]}:action==='roles'?{roles:[role]}:action==='sync'?{snapshot:progressOverride ?? (++syncCalls===1?base:changed)}:{};
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto(`${origin}/skland`);
 const refresh=page.getByRole('button',{name:'刷新数据',exact:true});await refresh.waitFor();
 await page.waitForFunction(()=>{const e=globalThis.document.querySelector('[aria-label="刷新数据"]');return e&&!e.disabled&&JSON.parse(localStorage.getItem('riic:endfield:workspace:v1')||'{}').operators?.length===2;});
 assert.equal(await page.getByRole('dialog',{name:'森空岛同步明细',exact:true}).count(),0,'Passive restoration must not open details');
 await page.screenshot({path:path.join(screenshotDirectory, 'endfield-skland-refined.png')});
 const sanity=page.getByRole('progressbar',{name:'理智',exact:true});
 const pass=page.getByRole('progressbar',{name:'通行证',exact:true});
 assert.equal(await sanity.getAttribute('value'),'90');assert.equal(await sanity.getAttribute('max'),'240');
 assert.equal(await pass.getAttribute('value'),'0');assert.equal(await pass.getAttribute('max'),'60');
 assert.equal(await sanity.evaluate(el=>el.getBoundingClientRect().height),10);
 await page.locator('summary').filter({hasText:'通行证进度'}).click();
 await page.locator('summary').filter({hasText:'理智恢复'}).click();
 assert.equal(await page.getByRole('progressbar',{name:'通行证进度',exact:true}).getAttribute('value'),'0');
 assert.equal(await page.getByRole('progressbar',{name:'理智恢复',exact:true}).getAttribute('value'),'90');
 await refresh.click();
 const dialog=page.getByRole('dialog',{name:'森空岛同步明细',exact:true});await dialog.waitFor();
 for(const heading of ['新增干员','练度与技能变化','设施等级变化','移出当前排班名单'])await dialog.getByRole('heading',{name:new RegExp('^'+heading)}).waitFor();
 await dialog.getByText('培养舱',{exact:true}).first().waitFor();
 assert.equal(await dialog.getByText('模拟演示',{exact:true}).count(),0);
 assert.equal(await dialog.getByText('管理员',{exact:true}).count(),0);
 assert.equal(await dialog.getByText('未导入及原因',{exact:true}).count(),0);
 await page.screenshot({path:path.join(screenshotDirectory, 'endfield-real-sync-desktop.png')});
 const firstGroup=dialog.locator('details').first();
 await firstGroup.locator('summary').click();assert.equal(await firstGroup.getAttribute('open'),null);
 await firstGroup.locator('summary').press('Enter');assert.equal(await firstGroup.getAttribute('open'),'');
 await page.evaluate(()=>globalThis.document.documentElement.classList.add('dark'));
 await page.waitForTimeout(250);
 await page.screenshot({path:path.join(screenshotDirectory, 'endfield-real-sync-dark.png')});
 await page.evaluate(()=>globalThis.document.documentElement.classList.remove('dark'));
 await dialog.getByRole('button',{name:'知道了',exact:true}).click();
 assert.equal(await sanity.getAttribute('value'),'240');assert.equal(await sanity.getAttribute('aria-valuetext'),'260 / 240');assert.equal(await pass.getAttribute('value'),'60');
 await page.getByRole('button',{name:'最近同步明细',exact:true}).click();await dialog.waitFor();
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(screenshotDirectory, 'endfield-real-sync-mobile.png')});
 assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'刷新数据',exact:true}).click();await dialog.waitFor();
 await dialog.getByText('本次没有配置变化',{exact:true}).waitFor();
 await page.waitForTimeout(350);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('riic:endfield:workspace:v1')));
 assert.deepEqual(saved.operators.map(o=>o.name).sort(),['佩丽卡','狼卫'].sort());assert.equal(saved.options.levels.grow,3);
 await dialog.getByRole('button',{name:'知道了',exact:true}).click();
 progressOverride=structuredClone(changed);progressOverride.details.dungeon={};progressOverride.details.bpSystem={};
 await refresh.click();await dialog.waitFor();await dialog.getByRole('button',{name:'知道了',exact:true}).click();
 assert.equal(await page.getByRole('progressbar',{name:'理智',exact:true}).count(),0);
 assert.equal(await page.getByRole('progressbar',{name:'通行证',exact:true}).count(),0);
 console.log('PASS: real sync path -> automatic details; actual adds/updates/removals/facilities/exclusions; reopen; mobile; repeated sync no changes; persisted applied values. Progress meters: zero, partial, full, overflow and missing values. Isolated browser fixture only.');

} finally {
  await browser?.close();
  if (vite.connected) vite.send('riic:stop');
  await Promise.race([exited,delay(5000,undefined,{ref:false})]);
  if (vite.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill',['/PID',String(vite.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    else vite.kill('SIGTERM');
  }
  account.closeAllConnections();
  await new Promise(resolve => account.close(resolve));
}
