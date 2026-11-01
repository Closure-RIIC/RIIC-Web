import { expect, test } from "@playwright/test";
import { mockApis, seedPreferences, requestId, authenticatedSklandSnapshot } from "./production-readiness.fixture";
import { gachaAccountOptions } from "../apps/arknights/src/gacha-accounts";

for (const count of [151, 1151]) test(`gacha ${count} digits fit fully and labels stay clear`, async ({ page }) => {
  const role = { uid: "10001", nickname: "预览角色", channelName: "官服", isDefault: true };
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: {
    ...authenticatedSklandSnapshot, player: { ...authenticatedSklandSnapshot.player, ...role }, roles: [role],
  } });
  await seedPreferences(page);
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: {
    session: { id: "preview-session", token: "test", userId: "test-user", expiresAt: new Date(Date.now()+3600000).toISOString() },
    user: { id: "test-user", name: "预览", email: "test@example.com", emailVerified: true },
  } }));
  await page.route("**/api/gacha/session", route => route.fulfill({ json: { success: true,
    data: gachaAccountOptions([], [role], []), requestId } }));
  await page.route("**/api/gacha/history?*", route => route.fulfill({ json: { success: true, data: {
    ...role, fetchedAt: new Date().toISOString(), warnings: [], records: Array.from({ length: count }, (_, i) => ({
      id: `draw-${i}`, category: "normal", poolId: "preview", poolName: "预览卡池", charId: "char_123_fang", charName: "芬", stars: 3, isNew: false,
      timestamp: Date.now() - i * 1000, pos: i,
    })),
  }, requestId } }));
  await page.goto("/gacha");
  const header = page.locator("[data-gacha-pool-card] > header").first();
  await expect(header.locator("dd")).toHaveAttribute("aria-label", String(count));
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(async () => {
      const bounds = await header.evaluate(el => {
        const label = el.querySelector('dt')!.getBoundingClientRect();
        const frame = el.querySelector('dd')!.getBoundingClientRect();
        const text = [...el.querySelectorAll<SVGTextElement>('svg text')].find(node => node.getBoundingClientRect().width > 0)!;
        const digits = text.getBoundingClientRect();
        const font = getComputedStyle(text);
        const canvas = document.createElement("canvas").getContext("2d")!;
        canvas.font = `${font.fontWeight} 100px ${font.fontFamily}`;
        const measured = canvas.measureText(text.textContent!);
        const factor = parseFloat(font.fontSize) / 100;
        const metrics = { fontBoundingBoxAscent: measured.fontBoundingBoxAscent * factor, fontBoundingBoxDescent: measured.fontBoundingBoxDescent * factor,
          actualBoundingBoxAscent: measured.actualBoundingBoxAscent * factor, actualBoundingBoxDescent: measured.actualBoundingBoxDescent * factor };
        const scale = digits.height / (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent);
        const matrix = text.getScreenCTM()!;
        const inkTop = font.fontSize === "1px" ? matrix.f - metrics.actualBoundingBoxAscent * matrix.d : digits.top + (metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent) * scale;
        const inkBottom = font.fontSize === "1px" ? matrix.f + metrics.actualBoundingBoxDescent * matrix.d : digits.bottom - (metrics.fontBoundingBoxDescent - metrics.actualBoundingBoxDescent) * scale;
        const header = el.getBoundingClientRect();
        return { labelRight: label.right, frameLeft: frame.left, top: inkTop, bottom: inkBottom, left: digits.left, right: digits.right,
          frameTop: frame.top, frameBottom: frame.bottom, frameRight: frame.right, headerBottom: header.bottom, headerTop: header.top };
      });
      expect(bounds.labelRight).toBeLessThanOrEqual(bounds.left + 1);
      expect(bounds.top).toBeGreaterThanOrEqual(bounds.frameTop - 1);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.frameBottom + 1);
      expect(bounds.right).toBeLessThanOrEqual(bounds.frameRight + 1);
      expect(bounds.bottom).toBeLessThan(bounds.headerBottom);
    }).toPass({ timeout: 3000 });
    await header.screenshot({ path: `outputs/gacha-${count}-${width}.png` });
  }
});

