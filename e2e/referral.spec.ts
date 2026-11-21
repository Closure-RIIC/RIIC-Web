import { expect, test } from "@playwright/test";
import { mockAnonymousWebsiteSession, mockApis, mockSignedInWebsiteSession, seedPreferences } from "./production-readiness.fixture";

const invitationCode = "ABCDEF0123456789ABCDEF01";
const campaign = { enabled: true, rewardPoints: 10, inviteePoints: 7, rewardLimit: 5, maxPoints: 50 };
const account = {
  code: invitationCode, registeredCount: 6, qualifiedCount: 5, rewardedCount: 5, earnedPoints: 50, welcomePoints: 7, remainingRewards: 0,
  referrals: ["pending", "qualified", "rewarded", "rejected", "capped"].map((status, index) => ({
    id: `referral-${index}`, createdAt: "2026-11-16T00:00:00.000Z", qualifiedAt: status === "pending" ? null : "2026-11-16T00:10:00.000Z",
    rewardedAt: status === "rewarded" ? "2026-11-16T00:10:00.000Z" : null, status, points: status === "rewarded" ? 10 : 0,
  })),
};

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await seedPreferences(page);
  // The website session is mocked, so its account-scoped background requests
  // must not fall through to a real server with no matching session cookie.
  await page.route("**/api/account/data-consent", route => route.fulfill({ json: {
    success: true, data: { current: false, cloudSyncEnabled: false },
  } }));
  await page.route("**/api/agent/chat", route => route.fulfill({ json: {
    success: true, data: { enabled: false, provider: "test", models: [] },
  } }));
});

test("closed campaign hides sharing and menu entry, then reflects reopening on focus", async ({ page }) => {
  await mockSignedInWebsiteSession(page);
  let enabled = false;
  await page.route("**/api/referral", route => route.fulfill({ json: { data: { ...campaign, enabled, account } } }));
  await page.goto("/referral");
  await expect(page.locator("[data-referral-disabled]")).toBeVisible();
  await expect(page.locator("[data-referral-earned]")).toContainText("50");
  await expect(page.getByText("我的新人奖励已到账：7 永久积分")).toBeVisible();
  await expect(page.locator("[data-referral-copy]")).toHaveCount(0);
  await page.locator("[data-sidebar-account-trigger]").click();
  await expect(page.locator('[data-primary-navigation-page="referral"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  enabled = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("[data-referral-copy]")).toBeVisible();
  await page.locator("[data-sidebar-account-trigger]").click();
  await expect(page.locator('[data-primary-navigation-page="referral"]')).toBeVisible();
});

test("real referral states and the five-person cap fit on mobile and expose a share QR", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSignedInWebsiteSession(page);
  await page.route("**/api/referral", route => route.fulfill({ json: { data: { ...campaign, account } } }));
  await page.goto("/referral");
  const content = page.locator("[data-referral-page]");
  await expect(content.getByText("奖励已领满", { exact: true })).toBeVisible();
  await expect(content).not.toContainText(/演示|首充/);
  await expect(page.locator("[data-referral-records] li")).toHaveCount(5);
  await expect(content.locator('[href="/skland"]')).toBeVisible();
  await expect(page.locator("[data-cloud-sync-error]")).toHaveCount(0);
  await expect(content.getByLabel("邀请链接", { exact: true })).toHaveValue(new RegExp(`/referral\\?ref=${invitationCode}$`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("referral-mobile.png"), fullPage: true });
  await content.getByText("奖励已领满", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("referral-mobile-progress.png"), fullPage: true });
  await content.getByRole("button", { name: "显示邀请二维码", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "邀请好友", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(invitationCode, { exact: true })).toBeVisible();
  await expect(dialog.locator("svg")).not.toHaveCount(0);
});

test("guest signup sends its invitation once, keeps it on failure, and never adds it to sign-in", async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await page.route("**/api/referral", route => route.fulfill({ json: { data: { ...campaign, account: null } } }));
  let signInSeen = false;
  await page.route("**/api/auth/sign-in/email", route => {
    expect(route.request().headers()["x-riic-referral-code"]).toBeUndefined();
    signInSeen = true;
    return route.fulfill({ status: 401, json: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" } });
  });
  let signups = 0;
  await page.route("**/api/auth/sign-up/email", route => {
    expect(route.request().headers()["x-riic-referral-code"]).toBe(invitationCode);
    signups += 1;
    return signups === 1
      ? route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE", message: "Try again" } })
      : route.fulfill({ json: { token: null, user: { id: "new-referral-user", name: "邀请测试", email: "referral@example.test", emailVerified: false } } });
  });
  await page.goto(`/referral?ref=${invitationCode.toLowerCase()}`);
  await page.getByRole("button", { name: "登录 / 注册网站账号", exact: true }).click();
  const panel = page.locator("[data-website-account-panel]");
  await panel.getByRole("textbox", { name: "邮箱", exact: true }).fill("referral@example.test");
  await panel.getByLabel("密码", { exact: true }).fill("Axy123!?");
  await panel.getByRole("button", { name: "登录", exact: true }).click();
  await expect.poll(() => signInSeen).toBe(true);
  await panel.getByRole("button", { name: "创建账号", exact: true }).click();
  await panel.getByLabel("昵称", { exact: true }).fill("邀请测试");
  await panel.getByLabel("密码", { exact: true }).fill("Axy123!?");
  await panel.getByLabel("确认密码", { exact: true }).fill("Axy123!?");
  await panel.getByRole("button", { name: "创建账号并发送验证码", exact: true }).click();
  await expect.poll(() => signups).toBe(1);
  await expect(panel.getByRole("alert")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("riic-referral-code"))).toBe(invitationCode);
  await panel.getByRole("button", { name: "创建账号并发送验证码", exact: true }).click();
  await expect(panel).toHaveAttribute("data-auth-step", "verify");
  await expect.poll(() => signups).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem("riic-referral-code"))).toBeNull();
});

test("signup lets a guest edit or remove a prefilled invitation and correct a rejected code", async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await page.route("**/api/referral", route => route.fulfill({ json: { data: { ...campaign, account: null } } }));
  const submissions: Array<{ code?: string; required?: string }> = [];
  await page.route("**/api/auth/sign-up/email", route => {
    const headers = route.request().headers();
    submissions.push({ code: headers["x-riic-referral-code"], required: headers["x-riic-require-referral"] });
    return submissions.length === 1
      ? route.fulfill({ status: 400, json: { code: "REFERRAL_CODE_UNAVAILABLE", message: "Unavailable" } })
      : route.fulfill({ json: { token: null, user: { id: "manual-signup", name: "邀请测试", email: "manual@example.test", emailVerified: false } } });
  });
  await page.goto(`/referral?ref=${invitationCode}`);
  await page.getByRole("button", { name: "登录 / 注册网站账号", exact: true }).click();
  const panel = page.locator("[data-website-account-panel]");
  const field = panel.getByLabel("邀请码（选填）");
  await expect(field).toHaveCount(0);
  await panel.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(field).toHaveValue(invitationCode);
  await panel.getByLabel("昵称", { exact: true }).fill("邀请测试");
  await panel.getByLabel("邮箱", { exact: true }).fill("manual@example.test");
  await panel.getByLabel("密码", { exact: true }).fill("Axy123!?");
  await panel.getByLabel("确认密码", { exact: true }).fill("Axy123!?");
  const submit = panel.getByRole("button", { name: "创建账号并发送验证码", exact: true });
  await field.fill("invalid");
  await submit.click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(submissions).toHaveLength(0);
  await field.fill(" 0123456789abcdef01234567 ");
  await submit.click();
  await expect(panel.getByRole("alert")).toContainText("邀请码当前不可用");
  expect(submissions).toEqual([{ code: "0123456789ABCDEF01234567", required: "1" }]);
  await field.fill("");
  await submit.click();
  await expect(panel).toHaveAttribute("data-auth-step", "verify");
  expect(submissions[1]).toEqual({ code: undefined, required: undefined });
});

test("failed campaign requests show a retry and never display demo rewards", async ({ page }) => {
  await mockSignedInWebsiteSession(page);
  await page.route("**/api/referral", async route => {
    // Background focus/session refreshes may request this endpoint too. Keep
    // failing until the user actually clicks Retry, so this tests manual retry.
    const retried = await page.evaluate(() => document.documentElement.hasAttribute("data-referral-retry-requested"));
    return retried ? route.fulfill({ json: { data: { ...campaign, account: { ...account, registeredCount: 0, qualifiedCount: 0, rewardedCount: 0, earnedPoints: 0, remainingRewards: 5, referrals: [] } } } }) : route.fulfill({ status: 503, json: {} });
  });
  await page.goto("/referral");
  // Wait for the mocked signed-in session to replace the anonymous SSR view.
  await expect(page.locator('[data-referral-page] [href="/skland"]')).toBeVisible();
  await expect(page.locator("[data-referral-page]").getByRole("alert")).toBeVisible();
  await expect(page.locator("[data-referral-earned]")).toHaveCount(0);
  const retry = page.getByRole("button", { name: "重新加载", exact: true });
  await retry.evaluate(button => button.addEventListener("click", () => {
    document.documentElement.setAttribute("data-referral-retry-requested", "true");
  }, { capture: true, once: true }));
  await retry.click();
  await expect(page.locator("[data-referral-empty]")).toBeVisible();
  await expect(page.locator("[data-referral-earned]")).toContainText("0");
});

test("the latest invitation survives navigation and signup before the campaign request completes", async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await page.addInitScript(code => sessionStorage.setItem("riic-referral-code", code), invitationCode);
  const latestCode = "0123456789ABCDEF01234567";
  let releaseCampaign!: () => void;
  const campaignPending = new Promise<void>(resolve => { releaseCampaign = resolve; });
  let campaignRequests = 0;
  let campaignResponses = 0;
  await page.route("**/api/referral", async route => {
    campaignRequests += 1;
    await campaignPending;
    campaignResponses += 1;
    await route.fulfill({ json: { data: { ...campaign, account: null } } });
  });
  let signupCode: string | undefined;
  await page.route("**/api/auth/sign-up/email", route => {
    signupCode = route.request().headers()["x-riic-referral-code"];
    return route.fulfill({ json: { token: null, user: {
      id: "slow-referral-user", name: "邀请测试", email: "slow-referral@example.test", emailVerified: false,
    } } });
  });
  try {
    await page.goto(`/referral?ref=${latestCode.toLowerCase()}`);
    await expect(page.locator("[data-referral-page]").getByRole("status")).toBeVisible();
    await expect.poll(() => campaignRequests).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("riic-referral-code"))).toBe(latestCode);
    await page.locator("[data-sidebar-settings-trigger]").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator("[data-referral-page]")).toHaveCount(0);
    await page.locator("[data-sidebar-account-trigger]").click();
    await page.locator("[data-sidebar-sign-in]").click();
    const panel = page.locator("[data-website-account-panel]");
    await panel.getByRole("button", { name: "创建账号", exact: true }).click();
    await panel.getByLabel("昵称", { exact: true }).fill("邀请测试");
    await panel.getByRole("textbox", { name: "邮箱", exact: true }).fill("slow-referral@example.test");
    await panel.getByLabel("密码", { exact: true }).fill("Axy123!?");
    await panel.getByLabel("确认密码", { exact: true }).fill("Axy123!?");
    await panel.getByRole("button", { name: "创建账号并发送验证码", exact: true }).click();
    await expect(panel).toHaveAttribute("data-auth-step", "verify");
    expect(signupCode).toBe(latestCode);
    expect(campaignResponses).toBe(0);
    expect(await page.evaluate(() => sessionStorage.getItem("riic-referral-code"))).toBeNull();
  } finally {
    releaseCampaign();
    await page.unrouteAll({ behavior: "wait" });
  }
});
