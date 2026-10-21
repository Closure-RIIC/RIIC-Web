import { expect, test } from '@playwright/test';
import layout252 from '../apps/arknights/src/layouts/252.json' with { type: 'json' };
import layout243 from '../apps/arknights/src/layouts/243.json' with { type: 'json' };
import { SESSION_KEY_V5 } from '../apps/arknights/src/persistence';
import { openAgentHistory } from './agent-history';
import { authenticatedSklandSnapshot, mockApis, planData, seedV4Session } from './production-readiness.fixture';

const result252 = {
  ...planData,
  diagnosticId: '33333333-3333-4333-8333-333333333333',
  profile: { ...planData.profile, layout_label: '252' },
  maa: { ...planData.maa, title: 'Agent 252 result' },
};
const session252 = {
  presetLabel: '252',
  layout: layout252,
  operbox: authenticatedSklandSnapshot.operbox,
  sourceName: 'Agent 252 operators',
  boxSource: 'skland',
  rotationProfile: 'abc_12_6_6',
  fiammettaEnabled: false,
  result: result252,
  activeShift: 0,
};

test('opening an Agent 252 schedule survives a late 243 Skland restore and reload', async ({ page }) => {
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: authenticatedSklandSnapshot });
  await seedV4Session(page, planData, { boxSource: 'skland', layoutDirty: false });
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: {
    user: { id: 'handoff-user', name: '博士', email: 'handoff@example.test' },
    session: { expiresAt: '2099-01-01T00:00:00Z' },
  } }));
  await page.route('**/api/account/data-consent', route => route.fulfill({ json: {
    success: true, data: { current: false, cloudSyncEnabled: false },
  } }));
  let holdRestore = false;
  let releaseRestore!: () => void;
  const restoreGate = new Promise<void>(resolve => { releaseRestore = resolve; });
  await page.route(/\/api\/skland\/accounts(?:[/?]|$)/, async route => {
    if (holdRestore && new URL(route.request().url()).searchParams.get('mode') !== 'summary') await restoreGate;
    await route.fallback();
  });
  const chunks = [
    { type: 'start', messageId: 'schedule252' }, { type: 'start-step' },
    { type: 'tool-input-available', toolCallId: 'solve252', toolName: 'solve_schedule', input: { layoutPreset: '252' } },
    { type: 'tool-output-available', toolCallId: 'solve252', output: {
      plan: { layoutLabel: '252', operboxLabel: 'Agent 252 operators', diagnosticId: result252.diagnosticId,
        durationMs: 42, summary: {}, dailyProduction: {}, plans: [], trainingAdvice: null }, workbenchSession: session252,
    } },
    { type: 'finish-step' }, { type: 'finish', finishReason: 'stop' },
  ];
  await page.route('**/api/agent/chat', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { success: true, data: { enabled: true, provider: 'deepseek', model: 'test' } } })
    : route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
      body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' }));
  await page.goto('/agent');
  await page.getByRole('textbox', { name: '发给可露希尔的消息' }).fill('生成 252 排班');
  await page.getByRole('textbox', { name: '发给可露希尔的消息' }).press('Enter');
  holdRestore = true;
  await page.getByRole('button', { name: '在基建计算器打开' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/可露希尔已完成排班（252）/)).toBeVisible();
  const restored = page.waitForResponse(response => /\/api\/skland\/accounts(?:[/?]|$)/.test(response.url()) && new URL(response.url()).searchParams.get('mode') !== 'summary');
  releaseRestore();
  await restored;
  // Allow the deferred response and the resulting React/persistence effects to settle.
  await page.waitForTimeout(500);
  const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SESSION_KEY_V5);
  await expect.poll(async () => (await saved()).presetLabel).toBe('252');
  expect((await saved()).result.diagnosticId).toBe(result252.diagnosticId);
  expect((await saved()).layout.rooms.filter((room: {kind: string}) => room.kind === 'factory')).toHaveLength(5);
  await expect(page.locator('[data-plan-board]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await expect.poll(async () => (await saved()).presetLabel).toBe('252');
  expect((await saved()).result.diagnosticId).toBe(result252.diagnosticId);
  expect(await page.evaluate(() => sessionStorage.getItem('riic-agent-artifact-handoff'))).toBeNull();
  await page.locator('[data-primary-navigation-page="agent"]').click();
  await openAgentHistory(page, '生成 252 排班');
  await page.getByRole('button', { name: '在基建计算器打开' }).click();
  await expect(page.getByText(/可露希尔已完成排班（252）/)).toBeVisible();
  await expect.poll(async () => (await saved()).presetLabel).toBe('252');
  expect((await saved()).result.diagnosticId).toBe(result252.diagnosticId);
});

test('an explicit Agent handoff stays selected when cloud restore starts after it', async ({ page }) => {
  await mockApis(page);
  await page.addInitScript(handoff => {
    sessionStorage.setItem('riic-agent-artifact-handoff', JSON.stringify({ ...handoff, expiresAt: Date.now() + 60_000 }));
    localStorage.setItem('arknights-infra-calc-beta-onboarding-v1', 'done');
  }, { preset: '252', session: { ...session252, boxSource: 'maa' } });
  let releaseAuth!: () => void;
  const authGate = new Promise<void>(resolve => { releaseAuth = resolve; });
  await page.route('**/api/auth/get-session', async route => {
    await authGate;
    await route.fulfill({ json: { user: { id: 'cloud-handoff-user', name: '博士', email: 'cloud@example.test' }, session: { expiresAt: '2099-01-01T00:00:00Z' } } });
  });
  await page.route('**/api/account/data-consent', route => route.fulfill({ json: {
    success: true, data: { current: true, cloudSyncEnabled: true },
  } }));
  let cloudReads = 0;
  await page.route('**/api/workspace', route => {
    expect(route.request().method()).toBe('GET');
    cloudReads++;
    return route.fulfill({ json: { success: true, data: {
      exists: true, revision: 1, state: {
        presetLabel: '243', layout: layout243, boxSource: 'maa', sourceName: 'Old 243',
        layoutDirty: false, layoutSource: 'local', localLayoutBackup: null,
        rotationProfile: 'abc_12_6_6', fiammettaEnabled: false, activeShift: 0,
      }, operbox: authenticatedSklandSnapshot.operbox, result: planData, revisions: [], updatedAt: null, syncedAt: null,
    } } });
  });
  await page.goto('/');
  await expect(page.getByText(/可露希尔已完成排班（252）/)).toBeVisible();
  releaseAuth();
  await expect.poll(() => cloudReads).toBeGreaterThan(0);
  await expect(page.locator('[data-cloud-sync-error]')).toContainText('AIC-DATA-8005');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SESSION_KEY_V5);
  expect(saved.presetLabel).toBe('252');
  expect(saved.result.diagnosticId).toBe(result252.diagnosticId);
  await expect(page.locator('[data-plan-board]')).toBeVisible();
});
