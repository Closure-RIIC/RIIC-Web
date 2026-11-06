import { gallerySamples } from "../apps/arknights/src/schedule-gallery";
import { test, expect } from "@playwright/test";
import { authenticatedSklandSnapshot, mockApis, mockAnonymousWebsiteSession, mockSignedInWebsiteSession, primarySklandAccount, requestId, seedV4Session } from "./production-readiness.fixture";

test("comparison QR entry requires website sign-in before requesting a QR", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await mockAnonymousWebsiteSession(page);
  let starts = 0;
  await page.route("**/api/skland/auth/qr", route => { starts++; return route.abort(); });
  await seedGallery(page);
  await page.goto("/schedule-gallery");
  await page.getByRole("button", { name: "选择对比 Box", exact: true }).click();
  await page.getByRole("tab", { name: "登录 / 扫码获取", exact: true }).click();
  await expect(page.locator("[data-gallery-website-login]")).toBeVisible();
  await expect(page.getByText("请先登录网站账号。登录完成后，会在此继续森空岛扫码，不离开当前作业。")).toBeVisible();
  expect(starts).toBe(0);
});

test("authorized QR results become the comparison Box and closing stops further polls", async ({ page }) => {
  test.setTimeout(120_000);
  await mockApis(page, { sklandConfigured: true });
  await mockSignedInWebsiteSession(page);
  await seedV4Session(page, null);
  await page.clock.install();
  let starts = 0;
  let polls = 0;
  let complete = true;
  await page.route("**/api/skland/auth/qr", route => {
    starts++;
    expect(route.request().postDataJSON().consent).toMatchObject({ termsAccepted: true, privacyAccepted: true });
    return route.fulfill({ json: { success: true, requestId, data: { scanId: `gallery-${starts}`, scanUrl: `hypergryph://scan_login?scanId=gallery-${starts}`, expiresInSeconds: 600, refreshAfterSeconds: 10 } } });
  });
  await page.route("**/api/skland/auth/qr/status", route => {
    polls++;
    return route.fulfill({ json: { success: true, requestId, data: complete ? {
      status: "authenticated", accounts: [primarySklandAccount], activeAccountId: primarySklandAccount.accountId, bindingCount: 1,
      scheduleSnapshot: { ...authenticatedSklandSnapshot, sourceName: "扫码测试 Box" }, statusSnapshot: authenticatedSklandSnapshot,
    } : { status: "waiting" } } });
  });
  await seedGallery(page);
  await page.goto("/schedule-gallery");
  await expect(page.locator('[data-gallery-entry="local-0"]')).toBeVisible();
  const personal = await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-calc-session-v5")!).operbox);
  await page.getByRole("button", { name: "选择对比 Box", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择对比 Box", exact: true });
  await picker.getByRole("tab", { name: "登录 / 扫码获取", exact: true }).click();
  const panel = picker.locator("[data-skland-login-panel]");
  await expect(panel).toBeVisible();
  expect(starts).toBe(0);
  await panel.getByRole("checkbox").nth(0).check();
  await panel.getByRole("checkbox").nth(1).check();
  await panel.locator("[data-skland-qr-refresh]").click();
  await expect(picker.getByRole("img", { name: "森空岛登录二维码" })).toBeVisible();
  await page.clock.fastForward(6_100);
  await expect(picker).toHaveCount(0);
  await expect(page.getByText("正在对比：扫码测试 Box", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-calc-session-v5")!).operbox)).toEqual(personal);
  complete = false;
  await page.getByRole("button", { name: "选择对比 Box", exact: true }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole("checkbox").nth(0).check();
  await panel.getByRole("checkbox").nth(1).check();
  await panel.locator("[data-skland-qr-refresh]").click();
  await expect(picker.getByRole("img", { name: "森空岛登录二维码" })).toBeVisible();
  await picker.getByRole("button", { name: "取消", exact: true }).click();
  await expect(picker).toHaveCount(0);
  const stoppedAt = polls;
  await page.clock.fastForward(30_000);
  expect(polls).toBe(stoppedAt);
});

async function seedGallery(page: import("@playwright/test").Page) {
 await page.route("**/api/schedule-gallery",route=>route.fulfill({json:{success:true,data:{entries:[],actor:null}}}));
 await page.addInitScript(entries=>{ if(!localStorage.getItem("riic.schedule-gallery.local.v1"))localStorage.setItem("riic.schedule-gallery.local.v1",JSON.stringify(entries.map(entry=>({...entry,id:entry.id.replace("sample-","local-"),source:"local"}))));},gallerySamples());
}
