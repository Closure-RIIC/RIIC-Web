import {readFile} from 'node:fs/promises';
import {expect,test} from '@playwright/test';
import {mockApis,seedV4Session} from './production-readiness.fixture';
async function manage(page:import('@playwright/test').Page){await page.getByRole('button',{name:'管理档案',exact:true}).click();return page.getByRole('dialog',{name:'本地账号档案',exact:true});}
test('local profiles switch roster and results, reload, and restore the original profile',async({page})=>{
 await mockApis(page);await seedV4Session(page);await page.goto('/');
 const select=page.getByRole('combobox',{name:'切换本地档案',exact:true});await expect(select).toHaveValue('默认档案');
 await manage(page);await page.getByRole('button',{name:'新建档案',exact:true}).click();
 await page.getByRole('textbox',{name:'档案名称',exact:true}).fill('B服小号');
 await page.getByRole('tab',{name:'仅复制布局',exact:true}).click();
 await page.getByRole('button',{name:'创建并切换',exact:true}).click();
 await expect(select).toHaveValue('B服小号');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('arknights-infra-calc-session-v5')!).operbox)).toBe(null);
 await page.reload();await expect(select).toHaveValue('B服小号');
 await select.click();await page.getByRole('option',{name:'默认档案',exact:true}).click();
 await expect(select).toHaveValue('默认档案');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('arknights-infra-calc-session-v5')!).operbox?.[0]?.name)).toBe('阿米娅');
 await expect.poll(()=>page.evaluate(()=>!!JSON.parse(localStorage.getItem('arknights-infra-calc-session-v5')!).result)).toBe(true);
});
test('local profile JSON download imports as a new profile after review',async({page})=>{
 await mockApis(page);await seedV4Session(page);await page.goto('/');await manage(page);
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前 JSON',exact:true}).click();const path=await(await downloaded).path();const text=await readFile(path!,'utf8');const data=JSON.parse(text);expect(data.format).toBe('riic-local-profiles');expect(data.profiles).toHaveLength(1);
 data.profiles[0].name='导入的官服号';data.profiles[0].data.session.operbox[0].token='do-not-import';
 await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'account.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
 await expect(page.getByRole('dialog')).toContainText('导入的官服号');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('riic-local-profiles-v1')!).profiles.length)).toBe(1);
 await page.getByRole('button',{name:'确认新增 1 个档案',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('status')).toContainText('已新增 1 个档案');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('riic-local-profiles-v1')!).profiles.length)).toBe(2);
 expect(await page.evaluate(()=>localStorage.getItem('riic-local-profiles-v1'))).not.toContain('do-not-import');
 await page.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.getByRole('combobox',{name:'切换本地档案',exact:true})).toHaveValue('默认档案');
});
test('invalid JSON leaves profiles untouched and English controls fit mobile',async({page,context,baseURL})=>{
 await mockApis(page);await seedV4Session(page);await page.goto('/');await manage(page);
 await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
 await expect(page.getByRole('alert')).toContainText('文件格式或内容无效');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('riic-local-profiles-v1')!).profiles.length)).toBe(1);
 await context.addCookies([{name:'riic-locale',value:'en',url:baseURL!}]);await page.setViewportSize({width:375,height:812});await page.reload();
 await page.getByRole('button',{name:'Manage profiles',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Stored only in this browser');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
