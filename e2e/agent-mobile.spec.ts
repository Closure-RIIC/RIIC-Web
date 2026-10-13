import { expect, test, type Page } from '@playwright/test';
import { mockApis } from './production-readiness.fixture';

async function setup(page: Page) {
  await mockApis(page);
  await page.route('**/api/account/data-consent', route => route.fulfill({ json: { success: true, data: { current: false, cloudSyncEnabled: false } } }));
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: {
    user: { id: 'mobile-agent-admin', name: '测试博士', role: 'admin' },
    session: { expiresAt: '2099-01-01T00:00:00Z' },
  } }));
  await page.route('**/api/billing', route => route.fulfill({ json: { data: { wallet: { totalPoints: 1234 } } } }));
  const models: string[] = [];
  await page.route('**/api/agent/chat', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: {
      enabled: true, provider: 'glm', models: [
        { id: 'deepseek', label: 'deepseek-v4.1-flash' }, { id: 'glm', label: 'glm-5.3-flash' },
      ],
    } } });
    models.push(route.request().postDataJSON().model);
    const chunks = [
      { type: 'start', messageId: `answer-${models.length}` }, { type: 'start-step' },
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: Array.from({ length: 24 }, (_, i) => `第 ${i + 1} 项：先确认基建配置，再比较收益和换班时间。`).join('\n\n') },
      { type: 'text-end', id: 'text' }, { type: 'finish-step' }, { type: 'finish', finishReason: 'stop' },
    ];
    return route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await page.goto('/agent');
  await expect(page.getByRole('combobox', { name: '助理模式：快速模式' })).toBeVisible();
  return models;
}

for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 740, height: 360 }]) {
  test(`mobile Agent reserves one row above and below the conversation at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    const models = await setup(page);
    await expect(page.locator('[data-app-topbar]')).toHaveCount(0);
    await expect(page.locator('[data-agent-credit-balance]')).toHaveAccessibleName('剩余积分 1,234');
    // Measure the final layout after the composer's entry translation settles.
    await page.locator('[data-agent-composer]').evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined)));
    });
    const bounds = await page.evaluate(() => {
      const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
      return { header: box('[data-agent-header]'), composer: box('[data-agent-composer]'), conversation: box('[aria-label="对话记录"]'), pageWidth: document.documentElement.scrollWidth };
    });
    expect(bounds.header.height).toBeLessThanOrEqual(52);
    expect(bounds.composer.height).toBeLessThanOrEqual(64);
    expect(bounds.composer.bottom).toBeLessThanOrEqual(size.height);
    expect(bounds.conversation.height).toBeGreaterThan(size.height - 140);
    expect(bounds.pageWidth).toBeLessThanOrEqual(size.width);

    const mode = page.getByRole('combobox', { name: '助理模式：快速模式' });
    await expect(mode).toContainText('deepseek-v4.1-flash');
    await mode.click();
    await page.getByRole('option', { name: /深度模式.*glm-5.3-flash/ }).click();
    await expect(page.getByRole('combobox', { name: '助理模式：深度模式' })).toContainText('glm-5.3-flash');
    const input = page.getByRole('textbox', { name: '发给可露希尔的消息' });
    await input.fill('请分析基建');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => models).toEqual(['glm']);
    await expect(page.locator('[data-agent-header-slot]')).toHaveAttribute('data-hidden', 'false');
    await expect(page.getByRole('button', { name: '新对话', exact: true })).toBeEnabled();

    const conversation = page.getByRole('region', { name: '对话记录' });
    const target = await conversation.elementHandle();
    await conversation.dispatchEvent('touchstart', { touches: [{ identifier: 0, target, clientY: 240 }] });
    await conversation.dispatchEvent('touchmove', { touches: [{ identifier: 0, target, clientY: 140 }] });
    await expect(page.locator('[data-agent-header-slot]')).toHaveAttribute('data-hidden', 'true');
    await expect.poll(async () => (await page.locator('[data-agent-header-slot]').boundingBox())?.height ?? 0).toBeLessThan(1);
    await conversation.dispatchEvent('touchmove', { touches: [{ identifier: 0, target, clientY: 220 }] });
    await expect(page.locator('[data-agent-header-slot]')).toHaveAttribute('data-hidden', 'false');
    await conversation.dispatchEvent('touchend', { touches: [] });

    await page.getByRole('button', { name: '附件与人格卡', exact: true }).click();
    await expect(page.getByRole('button', { name: '添加附件', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '人格卡：可露希尔', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '人格卡', exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(page.locator('[data-speaker="assistant"]')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '助理模式：快速模式' })).toBeVisible();
  });
}

test('desktop keeps its expanded composer and both mode labels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const models = await setup(page);
  await expect(page.getByRole('button', { name: '人格卡：可露希尔' })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加附件', exact: true })).toBeVisible();
  const input = page.getByRole('textbox', { name: '发给可露希尔的消息' });
  await input.fill('快速回答');
  await input.press('Enter');
  await expect.poll(() => models).toEqual(['deepseek']);
});
