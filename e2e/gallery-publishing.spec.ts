import {test,expect} from '@playwright/test';
import {mockApis} from './production-readiness.fixture';
test('production gallery has no demo roles and does not trust role headers',async({page,request})=>{
 await mockApis(page);await page.goto('/schedule-gallery');
 await expect(page.locator('[data-schedule-gallery]')).toBeVisible();
 await expect(page.getByRole('tablist',{name:'演示身份'})).toHaveCount(0);
 await expect(page.locator('[data-gallery-entry]')).toHaveCount(0);
 const denied=await request.get('/api/admin/schedule-gallery',{headers:{'X-Gallery-Demo-Role':'admin'}});
 expect([401,403]).toContain(denied.status());
});
