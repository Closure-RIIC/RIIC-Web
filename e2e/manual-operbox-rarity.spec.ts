import { expect, test, type Locator, type Page } from "@playwright/test";
import roster from "../fixtures/operbox_full_e2.json" with { type: "json" };
import { SESSION_KEY_V5, type PersistedSessionV5 } from "@riic/arknights-domain/persistence";
import { gotoStable, mockApis, planData, requestId, seedV4Session } from "./production-readiness.fixture";

const ownedBox = roster.filter((operator) => ["阿米娅", "银灰"].includes(operator.name))
  .map((operator) => ({ ...operator, elite: 1, level: 70 }));

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      user: { id: "rarity-test-user", name: "测试用户", email: "test@example.com", emailVerified: true },
    }),
  }));
});

async function openPicker(page: Page, mode: "manual" | "upgrade", mobile: boolean) {
  await mockApis(page);
  await seedV4Session(page, planData, { operbox: ownedBox, boxSource: "maa" });
  await gotoStable(page, "/");
  if (mode === "upgrade") {
    if (mobile) {
      await page.getByRole("button", { name: "调整方案", exact: true }).click();
      await page.getByRole("dialog", { name: "调整当前方案" })
        .getByRole("button", { name: /修改练度并重新计算/ })
        .click();
    } else {
      await page.getByRole("button", { name: "修改练度并重算", exact: true }).click();
    }
  } else {
    if (mobile) await page.locator("[data-calculator-more-tools] summary").click();
    await page.getByRole("button", { name: "配置Box与布局", exact: true }).filter({ visible: true }).click();
    await page.getByRole("button", { name: "第 1 步，共 3 步：干员数据", exact: true }).click();
    await page.getByRole("button", { name: "更换", exact: true }).click();
    await page.getByRole("tab", { name: "手动选择", exact: true }).click();
  }
  const picker = page.locator("[data-manual-operbox-picker]");
  await expect(picker).toBeVisible();
  return picker;
}

async function chooseRarity(picker: Locator, rarity: number | "all") {
  const tab = picker.getByRole("tablist", { name: "星级筛选", exact: true })
    .getByRole("tab", { name: rarity === "all" ? "全部" : `${rarity} 星干员`, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function assertFilterGeometry(picker: Locator) {
  const filter = picker.getByRole("tablist", { name: "星级筛选", exact: true });
  await filter.scrollIntoViewIfNeeded();
  const geometry = await filter.evaluate((element) => {
    const row = element.closest<HTMLElement>("[data-manual-operbox-rarity-filter]");
    const label = row?.querySelector<HTMLElement>(":scope > div:first-child");
    return {
      viewportWidth: window.innerWidth,
      labelCenter: label ? label.getBoundingClientRect().top + label.getBoundingClientRect().height / 2 : null,
      options: Array.from(element.querySelectorAll('[role="tab"]')).map((tab) => {
        const rect = tab.getBoundingClientRect();
        return { width: rect.width, height: rect.height, top: rect.top, center: rect.top + rect.height / 2 };
      }),
    };
  });
  expect(geometry.options).toHaveLength(7);
  expect(new Set(geometry.options.map((button) => Math.round(button.top))).size).toBe(1);
  expect(geometry.labelCenter).not.toBeNull();
  expect(geometry.options[0]?.center).toBeCloseTo(geometry.labelCenter ?? 0, 0);
  for (const tab of geometry.options) {
    expect(tab.width).toBeGreaterThanOrEqual(geometry.viewportWidth < 640 ? 44 : 28);
    expect(tab.height).toBeGreaterThanOrEqual(geometry.viewportWidth < 640 ? 44 : 24);
  }
}

async function assertUpgradeFilterBar(picker: Locator) {
  const filterBar = picker.locator("[data-upgrade-operbox-filters]");
  const geometry = await filterBar.getByRole("tablist").evaluateAll((tablists) => tablists.map((tablist) => ({
    label: tablist.getAttribute("aria-label"),
    top: Math.round(tablist.getBoundingClientRect().top),
  })));
  expect(geometry.map(({ label }) => label)).toEqual(["干员列表范围", "排班班次", "星级筛选", "职业筛选"]);
  expect(geometry[0]?.top).toBe(geometry[1]?.top);
  expect(geometry[2]?.top).toBe(geometry[3]?.top);
  expect(geometry[2]?.top).toBeGreaterThan(geometry[0]?.top ?? 0);
}

for (const mobile of [false, true]) {
  const device = mobile ? "mobile" : "desktop";
  test.describe(device, () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });

    test("manual Box combines rarity, search and ownership without losing hidden selections", async ({ page }, testInfo) => {
      test.slow();
      const picker = await openPicker(page, "manual", mobile);
      await expect(picker).not.toContainText("持有与精英阶段会同步用于排班和调整练度。");
      const professionFilter = picker.getByRole("tablist", { name: "职业筛选", exact: true });
      await professionFilter.getByRole("tab", { name: "术师", exact: true }).click();
      await picker.getByRole("textbox", { name: "搜索干员" }).fill("阿米娅");
      await expect(picker.getByRole("button", { name: "查看阿米娅的基建技能", exact: true })).toBeVisible();
      await professionFilter.getByRole("tab", { name: "近卫", exact: true }).click();
      await expect(picker.getByText("没有符合条件的干员。", { exact: true })).toBeVisible();
      await professionFilter.getByRole("tab", { name: "全部", exact: true }).click();
      await picker.getByRole("textbox", { name: "搜索干员" }).fill("");
      for (const rarity of [1, 2, 3, 4, 5, 6]) {
        await chooseRarity(picker, rarity);
        const count = Math.min(48, roster.filter((operator) => operator.rarity === rarity).length);
        await expect(picker.locator("article")).toHaveCount(count);
        expect(await picker.locator("article span.font-number").filter({ hasText: "★" }).allTextContents()).toEqual(Array(count).fill(`${rarity}★ · 最高精${rarity <= 2 ? 0 : rarity === 3 ? 1 : 2}`));
      }
      await picker.getByRole("button", { name: /显示更多干员/ }).click();
      await expect(picker.locator("article")).toHaveCount(96);
      await chooseRarity(picker, 5);
      await expect(picker.locator("article")).toHaveCount(48);
      await picker.getByRole("button", { name: "只看已拥有", exact: true }).click();
      await expect(picker.locator("article")).toHaveCount(1);
      await expect(picker.getByRole("button", { name: "查看阿米娅的基建技能", exact: true })).toBeVisible();
      await chooseRarity(picker, 6);
      await expect(picker.locator("article")).toHaveCount(1);
      await picker.getByRole("radiogroup", { name: "银灰持有与精英阶段", exact: true }).getByRole("radio", { name: "精2", exact: true }).click();
      await chooseRarity(picker, 5);
      await picker.getByRole("textbox", { name: "搜索干员" }).fill("银灰");
      await expect(picker.getByText("没有符合条件的干员。", { exact: true })).toBeVisible();
      await picker.getByRole("textbox", { name: "搜索干员" }).fill("");
      await chooseRarity(picker, "all");
      await expect(picker.locator("article")).toHaveCount(2);
      await expect(picker.getByRole("radiogroup", { name: "银灰持有与精英阶段", exact: true }).getByRole("radio", { name: "精2", exact: true })).toHaveAttribute("aria-checked", "true");
      await chooseRarity(picker, 5);
      await assertFilterGeometry(picker);
      await page.screenshot({ path: testInfo.outputPath(`manual-rarity-${device}.png`) });
      await picker.locator("[data-manual-operbox-apply]").first().click();
      await expect.poll(() => page.evaluate((key) => {
        const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
        return saved.operbox?.filter((operator: { own: boolean }) => operator.own).map((operator: { name: string; elite: number }) => [operator.name, operator.elite]);
      }, SESSION_KEY_V5)).toEqual([["银灰", 2], ["阿米娅", 1]]);
    });

    test("upgrade simulation combines rarity and schedule scope and submits the complete Box", async ({ page }, testInfo) => {
      test.slow();
      const picker = await openPicker(page, "upgrade", mobile);
      await assertUpgradeFilterBar(picker);
      const professionFilter = picker.getByRole("tablist", { name: "职业筛选", exact: true });
      await professionFilter.getByRole("tab", { name: "术师", exact: true }).click();
      await expect(picker.getByRole("button", { name: "查看阿米娅的基建技能", exact: true })).toBeVisible();
      await professionFilter.getByRole("tab", { name: "近卫", exact: true }).click();
      await expect(picker.getByText("没有符合条件的干员。", { exact: true })).toBeVisible();
      await professionFilter.getByRole("tab", { name: "全部", exact: true }).click();
      await chooseRarity(picker, 6);
      await expect(picker.getByText("没有符合条件的干员。", { exact: true })).toBeVisible();
      await picker.getByRole("tab", { name: /未进排班/ }).click();
      await picker.getByRole("button", { name: "只看已拥有", exact: true }).click();
      await expect(picker.locator("article")).toHaveCount(1);
      await picker.getByRole("radiogroup", { name: "银灰持有与精英阶段", exact: true }).getByRole("radio", { name: "精2", exact: true }).click();
      await chooseRarity(picker, 5);
      await expect(picker.getByText("没有符合条件的干员。", { exact: true })).toBeVisible();
      await picker.getByRole("tab", { name: /进入排班/ }).click();
      await expect(picker.locator("article")).toHaveCount(1);
      await expect(picker.getByRole("button", { name: "查看阿米娅的基建技能", exact: true })).toBeVisible();
      await picker.getByRole("textbox", { name: "搜索干员" }).fill("银灰");
      await expect(picker.getByText("没有符合条件的干员。", { exact: true })).toBeVisible();
      await picker.getByRole("textbox", { name: "搜索干员" }).fill("");
      await picker.getByRole("tab", { name: /^第一班/ }).click();
      await expect(picker.locator("article")).toHaveCount(1);
      await expect(picker.getByRole("tab", { name: /^第一班/ })).toHaveAttribute("data-slot", "tabs-trigger");
      await chooseRarity(picker, 6);
      await expect(picker.getByRole("tab", { name: "6 星干员", exact: true })).toHaveAttribute("data-slot", "tabs-trigger");
      await expect(picker.getByText("没有符合条件的干员。", { exact: true })).toBeVisible();
      await chooseRarity(picker, 5);
      await expect(picker.getByRole("tab", { name: /^第一班/ })).toHaveAttribute("aria-selected", "true");
      await assertFilterGeometry(picker);
      await page.screenshot({ path: testInfo.outputPath(`upgrade-rarity-${device}.png`) });

      let releasePlan = () => {};
      const pending = new Promise<void>((resolve) => { releasePlan = resolve; });
      let submitted: typeof ownedBox = [];
      await page.route("**/api/plan", async (route) => {
        submitted = route.request().postDataJSON().operbox;
        await pending;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: planData, requestId }) });
      });
      await picker.getByRole("button", { name: "保存练度并重新计算", exact: true }).first().click();
      try {
        await expect.poll(() => submitted.length).toBe(roster.length);
        expect(submitted.filter((operator) => operator.own).map((operator) => [operator.name, operator.elite])).toEqual([["银灰", 2], ["阿米娅", 1]]);
        for (const tab of await picker.getByRole("tablist", { name: "星级筛选", exact: true }).getByRole("tab").all()) {
          await expect(tab).toBeDisabled();
        }
      } finally {
        releasePlan();
      }
      await expect(page.locator("[data-upgrade-simulation-dialog]")).toBeHidden();
      await expect(page.locator('[data-slot="live-activity"]')).toContainText("调整练度已完成");
      const saved: PersistedSessionV5 = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), SESSION_KEY_V5);
      expect(saved.operbox?.find((operator) => operator.name === "银灰")?.elite).toBe(2);
    });
  });
}


for (const mode of ["manual", "upgrade"] as const) {
  test(`${mode} rarity filter supports English labels and keyboard selection`, async ({ page }) => {
    await mockApis(page);
    await seedV4Session(page, planData, { operbox: ownedBox, boxSource: "maa" });
    await page.addInitScript(() => localStorage.setItem("infra-demo-locale", "en"));
    await gotoStable(page, "/");
    if (mode === "upgrade") {
      await page.getByRole("button", { name: "Modify progression & recalculate", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "Configure BOX and base", exact: true }).filter({ visible: true }).click();
      await page.getByRole("button", { name: "Change", exact: true }).click();
      await page.getByRole("tab", { name: "Manual", exact: true }).click();
    }
    const picker = page.locator("[data-manual-operbox-picker]");
    const filter = picker.getByRole("tablist", { name: "Filter by rarity", exact: true });
    const all = filter.getByRole("tab", { name: "All", exact: true });
    await all.focus();
    await all.press("ArrowRight");
    const sixStar = filter.getByRole("tab", { name: "6-star operators", exact: true });
    await expect(sixStar).toBeFocused();
    await sixStar.press("Space");
    await expect(sixStar).toHaveAttribute("aria-selected", "true");
    if (mode === "upgrade") await expect(picker.getByText("No matching operators.", { exact: true })).toBeVisible();
    else await expect(picker.locator("article")).toHaveCount(48);
    await sixStar.press("ArrowLeft");
    await all.press("Space");
    await expect(all).toHaveAttribute("aria-selected", "true");
  });
}
