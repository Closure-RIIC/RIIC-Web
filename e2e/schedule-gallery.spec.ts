import {test,expect} from '@playwright/test';
import {mockApis} from './production-readiness.fixture';
import {gallerySamples,GALLERY_STORAGE_KEY} from '../apps/arknights/src/schedule-gallery';

test('gallery filters, bookmarks, local import and schedule copy work on desktop and mobile',async({page})=>{
 test.setTimeout(120000);await mockApis(page);
 await seedGallery(page);
 await page.goto('/schedule-gallery');const gallery=page.locator('[data-schedule-gallery]');
 await expect(gallery.getByRole('heading',{name:'作业广场',exact:true})).toBeVisible({timeout:60000});
 await expect(gallery.locator('[data-gallery-entry]')).toHaveCount(6);
 await gallery.getByRole('group',{name:'基建布局',exact:true}).getByRole('button',{name:'252',exact:true}).click();
 await expect(gallery.locator('[data-gallery-entry]')).toHaveCount(1);
 await gallery.getByRole('button',{name:'清除筛选',exact:true}).click();
 const first=gallery.locator('[data-gallery-entry="local-0"]');
 await first.getByRole('button',{name:'收藏或取消收藏：243 2班轮换',exact:true}).click();
 await gallery.getByRole('tab',{name:'我的收藏',exact:true}).click();await expect(gallery.locator('[data-gallery-entry]')).toHaveCount(1);
 await page.reload();await gallery.getByRole('tab',{name:'我的收藏',exact:true}).click();await expect(gallery.locator('[data-gallery-entry]')).toHaveCount(1);
 await gallery.getByRole('button',{name:'清除筛选',exact:true}).click();
 await gallery.getByRole('textbox',{name:'搜索作业、作者或干员'}).fill('no-such-schedule');await expect(gallery.getByText('暂时没有匹配的作业')).toBeVisible();
 await gallery.getByRole('button',{name:'清除筛选',exact:true}).first().click();
 await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:'outputs/作业广场-桌面.png',fullPage:true});
 await first.getByRole('button',{name:'查看详情',exact:true}).click();const dialog=page.getByRole('dialog');
 await expect(dialog.locator('[data-schedule-poster]')).toBeVisible();await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'outputs/作业广场-手机.png',fullPage:true});
 const doc=gallerySamples()[0]!.document;doc.meta.title='测试本地作业';
 await gallery.getByRole('button',{name:'添加作业',exact:true}).click();
 await page.locator('[data-file-upload-dialog] input[type="file"]').setInputFiles({name:'test.riic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
 await expect(gallery.getByRole('heading',{name:'测试本地作业',exact:true})).toBeVisible();
 await page.reload();await gallery.getByRole('tab',{name:'我添加的',exact:true}).click();await expect(gallery.getByRole('heading',{name:'测试本地作业',exact:true})).toBeVisible();
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]').length,GALLERY_STORAGE_KEY)).toBe(7);
 await gallery.locator('[data-gallery-entry]').filter({has:page.getByRole('heading',{name:'测试本地作业',exact:true})}).getByRole('button',{name:'抄这份作业',exact:true}).click();await expect(page).toHaveURL(/\/manual\?tab=poster/);
 await expect(page.getByText(/作业副本：测试本地作业/)).toBeVisible({timeout:60000});await expect(page.locator('[data-poster-workbench]')).toBeVisible();
});

async function seedGallery(page: import("@playwright/test").Page) {
 await page.route("**/api/schedule-gallery",route=>route.fulfill({json:{success:true,data:{entries:[],actor:null}}}));
 await page.addInitScript(entries=>{ if(!localStorage.getItem("riic.schedule-gallery.local.v1"))localStorage.setItem("riic.schedule-gallery.local.v1",JSON.stringify(entries.map(entry=>({...entry,id:entry.id.replace("sample-","local-"),source:"local"}))));},gallerySamples());
}
