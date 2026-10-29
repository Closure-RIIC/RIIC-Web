import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

/* global document, window, Event, fetch, AbortSignal */
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
// Run against start-admin-preview.mjs and an Endfield dev server with
// VITE_ARKNIGHTS_ORIGIN set to the preview origin. No database or real account is used.
const ak = process.env.CHANGELOG_PREVIEW_ORIGIN ?? "http://127.0.0.1:5205";
const ef = process.env.CHANGELOG_ENDFIELD_ORIGIN ?? "http://127.0.0.1:5206";
for (const origin of [ak, ef]) {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Only local preview origins are allowed");
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => {
    if (event.type() === "error" && /MISSING_MESSAGE|INVALID_MESSAGE|hydration|Minified React/.test(event.text())) errors.push(event.text());
  });
  await page.goto(ak + "/admin-preview/changelog", { timeout: 60_000 });
  const workspace = page.locator("[data-admin-changelog]");
  const form = workspace.locator("form");
  await expect(workspace).toHaveAttribute("data-release-application", "arknights");
  await expect(form.getByRole("button", { name: "弹窗通知", exact: true })).toBeVisible();
  await workspace.getByRole("button", { name: "终末地", exact: true }).click();
  await expect(workspace).toHaveAttribute("data-release-application", "endfield");
  await expect(page).toHaveURL(ak + "/admin-preview/changelog?application=endfield");
  await expect(form.getByRole("button", { name: "弹窗通知", exact: true })).toHaveCount(0);
  await expect(form.getByRole("button", { name: "预览弹窗", exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("region", { name: "日志列表", exact: true })).toContainText("暂无匹配的日志");
  await form.getByLabel("版本号", { exact: true }).fill("0.7.1");
  await form.getByLabel("更新标题", { exact: true }).fill("终末地草稿");
  await form.getByRole("region", { name: "新增", exact: true }).getByRole("button", { name: "添加条目", exact: true }).click();
  await form.getByLabel("新增 1", { exact: true }).fill("终末地简体内容");
  await form.getByRole("tab", { name: "繁体中文（可选）", exact: true }).click();
  await form.getByLabel("更新标题", { exact: true }).fill("終末地草稿");
  await form.getByLabel("新增 1", { exact: true }).fill("終末地繁體內容");
  await form.getByRole("tab", { name: "英文（可选）", exact: true }).click();
  await form.getByLabel("更新标题", { exact: true }).fill("Endfield draft");
  await form.getByLabel("新增 1", { exact: true }).fill("Endfield English content");
  await workspace.getByRole("button", { name: "明日方舟", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("放弃未保存修改？");
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(form.getByLabel("更新标题", { exact: true })).toHaveValue("Endfield draft");
  await expect(workspace).toHaveAttribute("data-release-application", "endfield");
  await form.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(workspace.getByRole("status")).toContainText("草稿已保存");
  await form.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("发布到终末地 · 本地环境？");
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await form.getByRole("button", { name: "预览日志", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("终末地简体内容");
  await page.keyboard.press("Escape");
  await workspace.getByRole("button", { name: "明日方舟", exact: true }).click();
  await expect(workspace).toHaveAttribute("data-release-application", "arknights");
  await expect(workspace.getByRole("region", { name: "日志列表", exact: true })).not.toContainText("终末地草稿");
  await expect(workspace.getByRole("region", { name: "日志列表", exact: true })).toContainText("排班与导出体验更新");
  await workspace.getByRole("button", { name: "终末地", exact: true }).click();
  await workspace.getByRole("region", { name: "日志列表", exact: true }).getByRole("button").filter({ hasText: "0.7.1" }).click();
  await expect(form.getByLabel("更新标题", { exact: true })).toHaveValue("终末地草稿");
  await form.getByLabel("更新标题", { exact: true }).fill("应放弃的修改");
  await workspace.getByRole("button", { name: "明日方舟", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect(workspace).toHaveAttribute("data-release-application", "arknights");
  // Browser history must restore the selected site, with saved content only.
  await page.goBack();
  await expect(workspace).toHaveAttribute("data-release-application", "endfield");
  await workspace.getByRole("region", { name: "日志列表", exact: true }).getByRole("button").filter({ hasText: "0.7.1" }).click();
  await expect(form.getByLabel("更新标题", { exact: true })).toHaveValue("终末地草稿");
  for (const [language, site, title] of [["繁體中文（台灣）", "終末地", "更新標題"], ["English", "Endfield", "Update title"]]) {
    await page.getByRole("button", { name: language, exact: true }).click();
    await expect(workspace.getByRole("button", { name: site, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(form.getByLabel(title, { exact: true })).toHaveValue("终末地草稿");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("[data-admin-changelog] *")]
    .filter(element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.right > window.innerWidth + 1; })
    .map(element => ({ tag: element.tagName, text: element.textContent?.slice(0, 70), width: element.getBoundingClientRect().width }))
    .slice(0, 8)), { message: "mobile workbench fits without horizontal overflow" }).toEqual([]);
  const redirect = await fetch(ef + "/admin/changelog", { redirect: "manual", signal: AbortSignal.timeout(60_000) });
  assert.ok([301, 302, 303, 307, 308].includes(redirect.status), "legacy URL redirects on the server");
  assert.equal(redirect.headers.get("location"), ak + "/admin/changelog?application=endfield");
  await page.route(ef + "/api/auth/get-session", route => route.fulfill({ json: {
    user: { id: "preview-admin", name: "Preview admin", email: "preview@example.test" }, session: { expiresAt: new Date(Date.now() + 3600_000).toISOString() },
  } }));
  await page.route(ef + "/api/endfield/admin/access", route => route.fulfill({ json: { success: true } }));
  await page.route(ef + "/api/endfield/releases", route => route.fulfill({ json: { success: true, data: { environment: "local", releases: [] } } }));
  await page.context().addCookies([{ name: "riic-endfield-locale", value: "zh-CN", url: ef }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(ef + "/changelog", { timeout: 60_000 });
  // SSR may resolve a signed-out session; a focus event refreshes it from our fixture.
  await expect(page.locator("body")).toHaveAttribute("data-app-hydrated", "true", { timeout: 30_000 });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const adminLink = page.getByRole("link", { name: "更新日志管理", exact: true });
  await expect(adminLink).toBeVisible();
  await expect(page.locator("[data-endfield-changelog]").getByRole("link", { name: "更新日志管理", exact: true })).toHaveCount(0);
  await adminLink.click();
  await expect(page).toHaveURL(ak + "/admin/changelog?application=endfield");
  await expect(page.locator("[data-admin-changelog]")).toHaveCount(0);
  assert.deepEqual(errors, [], "no client hydration or translation errors");
  console.log("PASS: unified preview, independent drafts, three-language editor, switch/discard/history guards, target confirmation, mobile width, legacy SSR/CSR redirect, public header and protected destination.");
} finally {
  await browser.close();
}
