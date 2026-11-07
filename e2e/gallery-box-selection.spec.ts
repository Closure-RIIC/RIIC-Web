import { test, expect } from "@playwright/test";
import { mockApis, seedV4Session } from "./production-readiness.fixture";
import { gallerySamples, galleryOperators } from "../apps/arknights/src/schedule-gallery";
import { defaultPosterOperator } from "../apps/arknights/src/schedule-poster-operators";

test("comparison files update missing operators without changing or uploading the personal roster", async ({ page }) => {
  test.setTimeout(120_000);
  await mockApis(page);
  const names = galleryOperators(gallerySamples()[0]!.document);
  const primary = defaultPosterOperator(names[0]!)!;
  const personal = defaultPosterOperator(names[1]!)!;
  await seedV4Session(page, null, { operbox: [personal] });
  let galleryWrites = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/schedule-gallery")) galleryWrites++; });
  await seedGallery(page);
  await page.goto("/schedule-gallery");
  const card = page.locator('[data-gallery-entry="local-0"]');
  await expect(card).toBeVisible({ timeout: 60_000 });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-calc-session-v5")!).operbox);
  await page.getByRole("button", { name: "选择对比 Box", exact: true }).click();
  await page.locator('[data-file-upload-dialog] input[type="file"]').setInputFiles({ name: "my-comparison.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([primary])) });
  await expect(card.getByText(`缺 ${names.length - 1} 名干员`, { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "查看详情", exact: true }).click();
  const comparison = page.locator("[data-gallery-comparison]");
  await expect(comparison.locator("[data-comparison-box-name]")).toContainText("my-comparison.json");
  await expect(comparison.getByText(personal.name, { exact: true })).toBeVisible();
  await expect(comparison.getByText(primary.name, { exact: true })).toHaveCount(0);
  await comparison.getByRole("button", { name: "选择对比 Box", exact: true }).click();
  await page.locator('[data-file-upload-dialog] input[type="file"]').setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("not json") });
  const upload = page.getByRole("dialog", { name: "选择对比 Box", exact: true });
  await expect(upload).toContainText("原来的对比 Box 已保留");
  await upload.getByRole("button", { name: "取消", exact: true }).click();
  await expect(comparison.locator("[data-comparison-box-name]")).toContainText("my-comparison.json");
  await comparison.getByRole("button", { name: "选择对比 Box", exact: true }).click();
  await page.locator('[data-file-upload-dialog] input[type="file"]').setInputFiles({ name: "complete.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(names.map(name => defaultPosterOperator(name)!))) });
  await expect(comparison.getByText("已持有这份作业需要的全部干员。", { exact: true })).toBeVisible();
  await comparison.getByRole("button", { name: "使用当前个人 Box", exact: true }).click();
  await expect(comparison.getByText(primary.name, { exact: true })).toBeVisible();
  await expect(comparison.getByText(personal.name, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-calc-session-v5")!).operbox)).toEqual(before);
  expect(galleryWrites).toBe(0);
});

async function seedGallery(page: import("@playwright/test").Page) {
 await page.route("**/api/schedule-gallery",route=>route.fulfill({json:{success:true,data:{entries:[],actor:null}}}));
 await page.addInitScript(entries=>{ if(!localStorage.getItem("riic.schedule-gallery.local.v1"))localStorage.setItem("riic.schedule-gallery.local.v1",JSON.stringify(entries.map(entry=>({...entry,id:entry.id.replace("sample-","local-"),source:"local"}))));},gallerySamples());
}
