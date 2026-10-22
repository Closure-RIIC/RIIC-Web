import { expect, test } from "@playwright/test";
import { mockApis, mockAnonymousWebsiteSession, seedV4Session } from "./production-readiness.fixture";

test.beforeEach(async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
});

test("inventory failure still allows manual estimates and ignores unscoped balances", async ({ page }) => {
  await mockApis(page);
  await page.route("**/api/skland/inventory", route => route.fulfill({
    status: 503, json: { success: false, error: { code: "UNAVAILABLE", message: "Inventory offline" } },
  }));
  await page.addInitScript(() => localStorage.setItem("aic-skland-inventory-manual-resources-v1", JSON.stringify({ "4002": "99999" })));
  await page.goto("/inventory");
  const originium = page.getByRole("textbox", { name: "填写至纯源石数量", exact: true });
  await expect(originium).toBeVisible({ timeout: 45_000 });
  await expect(originium).toBeEmpty();
  await originium.fill("10");
  await page.getByRole("textbox", { name: "填写合成玉数量", exact: true }).fill("600");
  await page.getByRole("textbox", { name: "填写高级凭证数量", exact: true }).fill("258");
  await expect(page.getByRole("status").filter({ hasText: "手填数量已保存到此浏览器" })).toBeVisible();
  await page.getByRole("button", { name: "资源估算", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("42", { exact: true })).toBeVisible();
  await dialog.getByRole("combobox", { name: "目标星级" }).click();
  await page.getByRole("option", { name: "3★", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "目标精英阶段" })).toHaveValue("精1");
  await expect(dialog.getByRole("combobox", { name: "目标等级" })).toHaveValue("55级");
  await dialog.getByRole("combobox", { name: "目标精英阶段" }).click();
  await expect(page.getByRole("option", { name: "精1", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "精2", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(originium).toHaveValue("10");
  await expect(page.getByRole("textbox", { name: "填写合成玉数量", exact: true })).toHaveValue("600");
  await expect(page.getByRole("textbox", { name: "填写高级凭证数量", exact: true })).toHaveValue("258");
  await originium.fill("0");
  await page.getByRole("textbox", { name: "填写合成玉数量", exact: true }).fill("");
  await page.goto("/account-health");
  await expect(page.locator("[data-account-health-page]")).toBeVisible();
  await page.goto("/inventory");
  await expect(originium).toHaveValue("0");
  await expect(page.getByRole("textbox", { name: "填写合成玉数量", exact: true })).toBeEmpty();
  await expect(page.getByRole("textbox", { name: "填写高级凭证数量", exact: true })).toHaveValue("258");
});

test("inventory reports browser storage failures without losing the current edit", async ({ page }) => {
  await mockApis(page);
  await page.route("**/api/skland/inventory", route => route.fulfill({
    status: 503, json: { success: false, error: { code: "UNAVAILABLE", message: "Inventory offline" } },
  }));
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("aic-skland-inventory-manual-resources-v1:")) {
        throw new DOMException("Storage full", "QuotaExceededError");
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto("/inventory");
  const originium = page.getByRole("textbox", { name: "填写至纯源石数量", exact: true });
  await originium.fill("10");
  await expect(originium).toHaveValue("10");
  await expect(page.getByRole("status").filter({ hasText: "浏览器保存失败" })).toBeVisible();
  await expect(page.getByText("手填数量已保存到此浏览器", { exact: false })).toHaveCount(0);
});

test("Mower trigger timing cancels with the rest of the draft", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  await page.goto("/mower");
  await page.getByRole("button", { name: "新建副表", exact: true }).click();
  await page.getByRole("button", { name: "编辑触发条件", exact: true }).click();
  await page.getByRole("combobox", { name: "触发时机" }).selectOption("BEGINNING");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "编辑触发条件", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "触发时机" })).toHaveValue("AFTER_PLANNING");
});

test("unreadable Mower drafts are preserved for recovery", async ({ page }) => {
  await mockApis(page);
  await page.addInitScript(() => localStorage.setItem("riic-web-mower-editor-v1", "{broken-draft"));
  await page.goto("/mower");
  await expect(page.getByText("无法恢复本地 Mower 排班。可重新导入文件。")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("riic-web-mower-editor-v1"))).toBe("{broken-draft");
});
