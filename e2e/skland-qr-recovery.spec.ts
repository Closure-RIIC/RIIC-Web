import { expect, test, type Page, type Route } from "@playwright/test";
import { authenticatedSklandSnapshot, mockApis, mockSignedInWebsiteSession, primarySklandAccount, requestId, seedPreferences } from "./production-readiness.fixture";

const qrImage = (page: Page) => page.getByRole("img", { name: "森空岛登录二维码" });
const refreshButton = (page: Page) => page.locator("[data-skland-qr-refresh]");
const qrStatus = (page: Page) => page.locator("[data-skland-login-qr]").getByRole("status");

async function openLogin(page: Page) {
  await mockSignedInWebsiteSession(page);
  await seedPreferences(page);
  await page.clock.install();
  await page.goto("/skland");
  await expect(page.locator("[data-skland-login-panel]")).toBeVisible();
  await acceptConsent(page);
}

async function acceptConsent(page: Page) {
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
}

function startResponse(scanId: string, refreshAfterSeconds = 10) {
  return { success: true, data: {
    scanId,
    scanUrl: `hypergryph://scan_login?scanId=${scanId}`,
    expiresInSeconds: 600,
    refreshAfterSeconds,
  }, requestId };
}

function statusResponse(status: "waiting" | "scanned", processing = false) {
  return { success: true, data: { status, processing }, requestId };
}

test("QR recovery shows binding progress when confirmation skips the scanned stage", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await page.route("**/api/skland/auth/qr", (route) => route.fulfill({ json: startResponse("quick-confirmation") }));
  await page.route("**/api/skland/auth/qr/status", (route) => route.fulfill({ json: statusResponse("scanned", true) }));
  await openLogin(page);
  await expect(qrImage(page)).toBeVisible();
  await expect(refreshButton(page)).toBeVisible();
  await expect(refreshButton(page)).toBeDisabled();

  await page.clock.fastForward(6_100);
  await expect(page.locator("[data-skland-login-progress]")).toBeVisible();
  await expect(qrImage(page)).toHaveCount(0);
  await expect(qrStatus(page)).toContainText("已确认，正在绑定账号");
  await page.clock.fastForward(4_100);
  await expect(refreshButton(page)).toBeEnabled();
  await expect(refreshButton(page)).toHaveText(/重新扫码/);
});

test("QR recovery keeps a usable code polling during an exact refresh rate-limit countdown", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  let starts = 0;
  let polls = 0;
  await page.route("**/api/skland/auth/qr", (route) => {
    starts += 1;
    return starts === 2
      ? route.fulfill({ status: 429, headers: { "Retry-After": "30" }, json: {
        success: false, requestId,
        error: { code: "AIC-RATE-6001", message: "刷新过于频繁，请稍后再试。", retryable: true, retryAfterSeconds: 30 },
      } })
      : route.fulfill({ json: startResponse(`rate-limit-${starts}`) });
  });
  await page.route("**/api/skland/auth/qr/status", (route) => {
    polls += 1;
    return route.fulfill({ json: statusResponse("waiting") });
  });
  await openLogin(page);
  await expect(qrImage(page)).toBeVisible();
  const originalCode = await qrImage(page).locator("path").last().getAttribute("d");
  await page.clock.fastForward(10_100);
  await expect(refreshButton(page)).toBeEnabled();
  await refreshButton(page).click();
  await expect(page.getByRole("alert")).toContainText("刷新过于频繁");
  await expect(qrImage(page)).toBeVisible();
  await expect(qrImage(page).locator("path").last()).toHaveAttribute("d", originalCode!);
  await expect(refreshButton(page)).toBeDisabled();
  await expect(page.locator("[data-skland-qr-cooldown]")).toContainText("30");
  const pollsBeforeCountdown = polls;

  await page.clock.fastForward(6_100);
  await expect.poll(() => polls).toBeGreaterThan(pollsBeforeCountdown);
  await expect(refreshButton(page)).toBeDisabled();
  await page.clock.fastForward(24_100);
  await expect(refreshButton(page)).toBeEnabled();
  expect(starts).toBe(2);
  await refreshButton(page).click();
  await expect.poll(() => starts).toBe(3);
  await expect(qrImage(page).locator("path").last()).not.toHaveAttribute("d", originalCode!);
});

test("QR recovery requests a fresh code after a page reload and a new consent", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  let starts = 0;
  await page.route("**/api/skland/auth/qr", (route) => route.fulfill({ json: startResponse(`reload-${++starts}`) }));
  await page.route("**/api/skland/auth/qr/status", (route) => route.fulfill({ json: statusResponse("waiting") }));
  await openLogin(page);
  await expect(qrImage(page)).toBeVisible();
  const originalCode = await qrImage(page).locator("path").last().getAttribute("d");
  await page.clock.fastForward(10_100);
  await page.reload();
  await expect(page.locator("[data-skland-login-panel]")).toBeVisible();
  await expect(qrImage(page)).toHaveCount(0);
  expect(starts).toBe(1);
  await acceptConsent(page);
  await expect.poll(() => starts).toBe(2);
  await expect(qrImage(page)).toBeVisible();
  await expect(qrImage(page).locator("path").last()).not.toHaveAttribute("d", originalCode!);
});

test("QR recovery stops terminal authentication errors even after visibility and online changes", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  let polls = 0;
  await page.route("**/api/skland/auth/qr", (route) => route.fulfill({ json: startResponse("terminal-error") }));
  await page.route("**/api/skland/auth/qr/status", (route) => {
    polls += 1;
    return polls === 1
      ? route.fulfill({ json: statusResponse("scanned", true) })
      : route.fulfill({ status: 422, json: { success: false, requestId,
        error: { code: "AIC-REQ-1001", message: "绑定失败，请重新扫码。", retryable: false },
      } });
  });
  await openLogin(page);
  await expect(qrImage(page)).toBeVisible();
  await page.clock.fastForward(6_100);
  await expect(page.locator("[data-skland-login-progress]")).toBeVisible();
  await page.clock.fastForward(6_100);
  await expect(page.getByRole("alert")).toContainText("绑定失败，请重新扫码。");
  await expect(page.locator("[data-skland-login-progress]")).toHaveCount(0);
  await expect(refreshButton(page)).toBeEnabled();
  const terminalPollCount = polls;
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await page.clock.fastForward(60_000);
  expect(polls).toBe(terminalPollCount);
});

test("QR recovery ignores authentication from an old request after manual replacement", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  let starts = 0;
  let oldPoll: Route | undefined;
  await page.route("**/api/skland/auth/qr", (route) => route.fulfill({ json: startResponse(`replace-${++starts}`) }));
  await page.route("**/api/skland/auth/qr/status", (route) => {
    if (route.request().postDataJSON().scanId === "replace-1") {
      oldPoll = route;
      return;
    }
    return route.fulfill({ json: statusResponse("waiting") });
  });
  await openLogin(page);
  await expect(qrImage(page)).toBeVisible();
  const originalCode = await qrImage(page).locator("path").last().getAttribute("d");
  await page.clock.fastForward(10_100);
  await expect.poll(() => Boolean(oldPoll)).toBe(true);
  await refreshButton(page).click();
  await expect.poll(() => starts).toBe(2);
  await expect(qrImage(page).locator("path").last()).not.toHaveAttribute("d", originalCode!);
  const currentCode = await qrImage(page).locator("path").last().getAttribute("d");

  await oldPoll!.fulfill({ json: { success: true, requestId, data: {
    status: "authenticated", scheduleSnapshot: authenticatedSklandSnapshot,
    statusSnapshot: authenticatedSklandSnapshot, accounts: [primarySklandAccount],
    activeAccountId: primarySklandAccount.accountId,
  } } });
  await page.clock.fastForward(6_100);
  await expect(page.locator("[data-skland-login-panel]")).toBeVisible();
  await expect(qrImage(page).locator("path").last()).toHaveAttribute("d", currentCode!);
});

test("QR recovery exposes generation timeout and allows a new request", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  let starts = 0;
  let stalledGeneration: Route | undefined;
  await page.route("**/api/skland/auth/qr", (route) => {
    starts += 1;
    if (starts === 1) { stalledGeneration = route; return; }
    return route.fulfill({ json: startResponse(`timeout-${starts}`) });
  });
  await page.route("**/api/skland/auth/qr/status", (route) => route.fulfill({ json: statusResponse("waiting") }));
  await openLogin(page);
  await expect(qrStatus(page)).toContainText("正在生成二维码");
  await expect.poll(() => Boolean(stalledGeneration)).toBe(true);
  await page.clock.fastForward(40_100);
  await expect(page.getByRole("alert")).toContainText("超时");
  await expect(refreshButton(page)).toBeEnabled();
  expect(starts).toBe(1);
  await refreshButton(page).click();
  await expect(qrImage(page)).toBeVisible();
  expect(starts).toBe(2);
  await stalledGeneration!.fulfill({ json: startResponse("late-timeout-result") });
});

test("QR recovery exposes a stalled status request and still permits manual replacement", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  let starts = 0;
  let stalledPoll: Route | undefined;
  await page.route("**/api/skland/auth/qr", (route) => route.fulfill({ json: startResponse(`query-timeout-${++starts}`) }));
  await page.route("**/api/skland/auth/qr/status", (route) => {
    if (route.request().postDataJSON().scanId === "query-timeout-1") { stalledPoll = route; return; }
    return route.fulfill({ json: statusResponse("waiting") });
  });
  await openLogin(page);
  await expect(qrImage(page)).toBeVisible();
  await page.clock.fastForward(6_100);
  await expect.poll(() => Boolean(stalledPoll)).toBe(true);
  await page.clock.fastForward(35_100);
  await expect(page.getByRole("alert")).toContainText("超时");
  await expect(refreshButton(page)).toBeEnabled();
  await refreshButton(page).click();
  await expect.poll(() => starts).toBe(2);
  await expect(qrImage(page)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await stalledPoll!.fulfill({ json: statusResponse("scanned", true) });
  await expect(page.locator("[data-skland-login-progress]")).toHaveCount(0);
});
