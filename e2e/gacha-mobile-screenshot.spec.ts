import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { authenticatedSklandSnapshot, mockApis, mockSignedInWebsiteSession, primarySklandAccount, seedPreferences } from "./production-readiness.fixture";
import { gachaAccountOptions } from "../apps/arknights/src/gacha-accounts";
import type { GachaHistory, GachaRecord } from "@riic/arknights-domain/gacha-history";

const history: GachaHistory = {
  uid: authenticatedSklandSnapshot.player.uid,
  nickname: authenticatedSklandSnapshot.player.nickname,
  fetchedAt: new Date().toISOString(),
  warnings: [],
  records: Array.from({ length: 96 }, (_, index): GachaRecord => ({
    id: "screenshot-" + index, category: "normal", poolId: "screenshot-pool", poolName: "截图测试卡池",
    charId: "char_103_angel", charName: "能天使", stars: index % 12 === 0 ? 6 : index % 6 === 0 ? 5 : 4,
    isNew: index === 0, timestamp: Date.now() - index * 1000, pos: 0,
  })),
};

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: authenticatedSklandSnapshot });
  await mockSignedInWebsiteSession(page);
  await seedPreferences(page);
  await page.route("**/api/gacha/session", route => route.fulfill({ json: { success: true, data: gachaAccountOptions([primarySklandAccount], [history], [primarySklandAccount.roles[0]]) } }));
  await page.route("**/api/gacha/history?*", route => route.fulfill({ json: { success: true, data: history } }));
});

async function openRecords(page: Page) {
  await page.goto("/gacha");
  await expect(page.locator("[data-gacha-interval]").first()).toBeVisible({ timeout: 45_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function openToolbar(page: Page) {
  const toggle = page.getByRole("button", { name: "展开操作按钮", exact: true });
  await toggle.click();
  await expect(page.getByRole("button", { name: "收起操作按钮", exact: true })).toHaveCSS("background-color", "rgb(255, 255, 255)");
}

async function capture(page: Page) {
  await page.locator('[data-gacha-action="screenshot"]').click();
  const dialog = page.locator("[data-gacha-screenshot-dialog]");
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  const image = dialog.locator("[data-gacha-screenshot-preview]");
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("naturalWidth", 780);
  await expect(image).toHaveJSProperty("naturalHeight", 1688);
  return dialog;
}

test("mobile toolbar captures the scrolled viewport and downloads a PNG without native sharing", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
  });
  await openRecords(page);
  const toggle = page.getByRole("button", { name: "展开操作按钮", exact: true });
  await expect(toggle).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(toggle).toHaveCSS("width", "36px");
  await expect(toggle).toHaveCSS("height", "36px");
  await expect(toggle).toHaveCSS("border-top-width", "0px");
  await expect(toggle).toHaveCSS("box-shadow", "none");
  await toggle.hover();
  await expect(toggle).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await openToolbar(page);
  await expect(page.locator('[data-gacha-action="screenshot"]')).toHaveCSS("width", "48px");
  await expect(page.locator('[data-gacha-action="authorize"]')).toBeHidden();
  await expect(page.locator('[data-gacha-action="disconnect"]')).toBeHidden();
  await expect(page.locator('[data-gacha-action="five-stars"]')).toBeVisible();
  await expect(page.locator('[data-gacha-action="delete"]')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('[data-gacha-action="authorize"]')).toBeVisible();
  await expect(page.locator('[data-gacha-action="disconnect"]')).toBeVisible();
  await expect(page.locator('[data-gacha-action="screenshot"]')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  const record = page.locator("[data-gacha-interval]").nth(5);
  await record.scrollIntoViewIfNeeded();
  const marker = await record.evaluate(row => {
    const marker = document.createElement("div");
    marker.style.cssText = "position:absolute;left:0;top:0;width:24px;height:24px;z-index:20;background:rgb(13,201,145)";
    row.style.position = "relative";
    row.appendChild(marker);
    const bounds = marker.getBoundingClientRect();
    const action = document.querySelector<HTMLElement>('[data-gacha-action="screenshot"]')!;
    action.style.setProperty("background", "rgb(255,0,255)", "important");
    const toolbar = action.getBoundingClientRect();
    return { x: bounds.left + 10, y: bounds.top + 10, toolbarX: toolbar.left + 8, toolbarY: toolbar.top + toolbar.height / 2 };
  });
  expect(marker.y).toBeGreaterThan(0);
  expect(marker.y).toBeLessThan(844);
  const dialog = await capture(page);
  await expect(dialog.getByRole("button", { name: "系统分享", exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/在 iPhone 系统分享|也可长按图片/)).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    dialog.getByRole("button", { name: "下载 PNG", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^riic-gacha-.*\.png$/);
  const output = testInfo.outputPath("gacha-viewport.png");
  await download.saveAs(output);
  const bytes = await readFile(output);
  const image = sharp(bytes);
  const metadata = await image.metadata();
  expect(metadata).toMatchObject({ format: "png", width: 780, height: 1688 });
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => Array.from(data.subarray((Math.round(y * 2) * info.width + Math.round(x * 2)) * info.channels, (Math.round(y * 2) * info.width + Math.round(x * 2)) * info.channels + 3));
  expect(pixel(marker.x, marker.y)).toEqual([13, 201, 145]);
  expect(pixel(marker.toolbarX, marker.toolbarY)).not.toEqual([255, 0, 255]);
});

test("native file sharing has a fresh user gesture and recovers from cancellation and denial", async ({ page }) => {
  await page.addInitScript(() => {
    let attempts = 0;
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (data: ShareData) => data.files?.[0]?.type === "image/png" });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => {
      attempts += 1;
      document.documentElement.dataset.sharedScreenshot = JSON.stringify({ active: navigator.userActivation.isActive, fileName: data.files?.[0]?.name, type: data.files?.[0]?.type, size: data.files?.[0]?.size, count: data.files?.length, attempts });
      if (attempts === 1) throw new DOMException("Cancelled", "AbortError");
      if (attempts === 2) throw new DOMException("Denied", "NotAllowedError");
    } });
  });
  await openRecords(page);
  await openToolbar(page);
  const dialog = await capture(page);
  const share = dialog.getByRole("button", { name: "系统分享", exact: true });
  await share.click();
  await expect(share).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await share.click();
  await expect(dialog.getByRole("alert")).toContainText("长按图片保存或下载 PNG");
  await share.click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  const sent = await page.evaluate(() => JSON.parse(document.documentElement.dataset.sharedScreenshot!));
  expect(sent).toMatchObject({ active: true, type: "image/png", count: 1, attempts: 3 });
  expect(sent.size).toBeGreaterThan(1000);
  expect(sent.fileName).toMatch(/\.png$/);
  await dialog.locator('[data-slot="dialog-close"]').click();
  await expect(dialog).toBeHidden();
});

test("mobile authorization remains reachable when the archive has no authorization", async ({ page }) => {
  await page.route("**/api/gacha/session", route => route.fulfill({ json: { success: true, data: gachaAccountOptions([primarySklandAccount], [history], []) } }));
  await openRecords(page);
  await expect(page.getByText("云端记录仍然保留，重新授权后可继续刷新。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "授权记录", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "授权寻访记录", exact: true })).toBeVisible();
});

test("exported laurels and progress bars match rendering within one-pixel SVG rasterization offsets", async ({ page }, testInfo) => {
  await openRecords(page);
  const laurels = [
    page.locator('[data-gacha-rating="current"] svg').first(),
    page.locator('[data-gacha-rating="current"] svg').last(),
    page.locator('[data-gacha-rating="career"] svg').first(),
    page.locator('[data-gacha-rating="career"] svg').last(),
  ];
  const regions = [
    ...laurels,
    page.locator('[data-gacha-draw-bar] > [aria-hidden="true"]').first(),
    page.locator("[data-gacha-draw-bar]").first(),
  ];
  const bounds = [];
  for (const region of regions) {
    await expect(region).toBeInViewport();
    bounds.push((await region.boundingBox())!);
  }
  const original = await page.screenshot({ animations: "disabled", path: testInfo.outputPath("gacha-browser-rendering.png") });
  await openToolbar(page);
  const dialog = await capture(page);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    dialog.getByRole("button", { name: "下载 PNG", exact: true }).click(),
  ]);
  const output = testInfo.outputPath("gacha-render-fidelity.png");
  await download.saveAs(output);
  const exported = await readFile(output);
  const differences = [];
  for (const [regionIndex, area] of bounds.entries()) {
    const rectangle = { left: Math.round(area.x * 2), top: Math.round(area.y * 2), width: Math.floor(area.width * 2), height: Math.floor(area.height * 2) };
    const before = await sharp(original).extract(rectangle).removeAlpha().raw().toBuffer();
    const offsets = regionIndex < laurels.length ? [-1, 0, 1] : [0];
    const rasterErrors = [];
    for (const offsetX of offsets) {
      for (const offsetY of offsets) {
        const after = await sharp(exported).extract({ ...rectangle, left: rectangle.left + offsetX, top: rectangle.top + offsetY }).removeAlpha().raw().toBuffer();
        rasterErrors.push(before.reduce((total, value, index) => total + Math.abs(value - after[index]), 0) / before.length);
      }
    }
    differences.push(Math.min(...rasterErrors));
  }
  console.log("Screenshot RGB mean errors (current laurels, career laurels, bar fill, full bar):", differences);
  for (const difference of differences) expect(difference).toBeLessThan(15);
});
