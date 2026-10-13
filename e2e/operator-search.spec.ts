import { expect, test } from "@playwright/test";
import { mockApis } from "./production-readiness.fixture";

test("latest operators expose their skills and portraits without duplicate Amiya forms", async ({ page }) => {
  await mockApis(page);
  await page.goto("/skills");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  const results = page.locator("[data-skill-query-page]");
  const search = results.getByRole("textbox");
  for (const [name, skill] of [["德·托莱多", "拉拢听众"], ["旅骨", "拾荒者"], ["克莱门莎", "合作原则"]]) {
    await search.fill(name);
    const row = results.getByRole("article", { name: `${name} 的基建技能`, exact: true });
    await expect(row).toBeVisible();
    await expect(row.getByText(skill, { exact: true })).toBeVisible();
    const portrait = row.locator('img[src^="/images/operator-portraits/"]');
    await expect(portrait).toHaveCount(1);
    await expect.poll(() => portrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  }
  await search.fill("阿米娅");
  // Search also matches other operators whose skill descriptions mention Amiya.
  await expect(results.getByRole("article", { name: /^阿米娅/ })).toHaveCount(1);
  await expect(results.getByRole("article", { name: /阿米娅.*(?:近卫|医疗)/ })).toHaveCount(0);
  await expect(results.getByRole("article", { name: "阿米娅 的基建技能", exact: true })).toBeVisible();
});

test("skill search combines Chinese pinyin and English operator names", async ({ page }) => {
  await mockApis(page);
  await page.goto("/skills");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  const results = page.locator("[data-skill-query-page]");
  const search = results.getByRole("textbox");
  for (const [query, name] of [["nts", "能天使"], ["amiya", "阿米娅"], ["choubai", "仇白"], ["qiubai", "仇白"]]) {
    await search.fill(query);
    await expect(search).toHaveValue(query);
    await expect(results.getByRole("article", { name: `${name} 的基建技能`, exact: true })).toBeVisible();
  }
  await search.fill("Exusiai");
  await expect(results.getByRole("article", { name: /能天使/ })).toHaveCount(0);
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(results.getByRole("article", { name: "Exusiai's infrastructure skills", exact: true })).toBeVisible();
  await search.fill("nts");
  await expect(results.getByRole("article", { name: "Exusiai's infrastructure skills", exact: true })).toBeVisible();
});
