import { test, expect } from '@playwright/test';
import layout from '@riic/arknights-domain/layouts/243.json' with { type: 'json' };
import { createManualScheduleDraft } from '../apps/arknights/src/manual-schedule';
import { createPosterDocument } from '../apps/arknights/src/schedule-poster-document';
import { mockApis } from './production-readiness.fixture';
for (const scenario of ['images', 'export-module', 'share-api', 'background'])
    test(scenario, async ({ page }) => {
        await mockApis(page);
        let blocked = 0;
        await page.route('**/*', route => { const r = route.request(); const stop = scenario === 'images' ? r.resourceType() === 'image' : scenario === 'export-module' ? r.url().includes('html2canvas-pro') : r.url().includes('/api/schedule-posters'); if (stop) {
            blocked++;
            return route.abort('failed');
        } return route.fallback(); });
        const doc = createPosterDocument(layout, createManualScheduleDraft([12, 12]));
        await page.addInitScript(doc => { localStorage.setItem('arknights-infra-calc-beta-onboarding-v1', '1'); sessionStorage.setItem('riic.schedule-poster.handoff.v1.manual', JSON.stringify(doc)); }, doc);
        await page.goto('/manual?tab=poster');
        const board = page.locator('[data-poster-workbench]');
        await expect(board.locator('[data-schedule-poster]')).toBeVisible({ timeout: 60000 });
        if (scenario === 'background') {
            await board.getByText('背景与展示设施', { exact: true }).click();
            await board.getByLabel('替换背景图片', { exact: true }).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') });
        }
        if (scenario === 'images' || scenario === 'background') {
            const d = page.waitForEvent('download', { timeout: 30000 });
            await board.getByRole('button', { name: '导出一页 PNG', exact: true }).click();
            expect((await d).suggestedFilename()).toMatch(/\.png$/);
            await expect(board.getByRole('status')).toContainText('部分字体、头像或背景加载失败');
        }
        else {
            await board.getByRole('button', { name: scenario === 'share-api' ? '生成作业码' : '导出一页 PNG', exact: true }).click();
            await expect(board.getByRole('alert')).toBeVisible();
            await expect(board.getByRole('alert')).toContainText(scenario === 'share-api' ? '可先下载作业文件分享' : '图片导出失败或超时');
            await expect(board.getByRole('button', { name: '下载作业文件', exact: true })).toBeEnabled();
            if (scenario === 'share-api')
                expect(blocked).toBe(1);
        }
        if (scenario !== 'background') expect(blocked).toBeGreaterThan(0);
    });
