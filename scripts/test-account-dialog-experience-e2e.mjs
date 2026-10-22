import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { URL } from "node:url";
import { chromium, expect as baseExpect } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 30000 });
const apps = [
  { name: "arknights", origin: process.env.ARKNIGHTS_E2E_ORIGIN || "http://127.0.0.1:5174", path: "/account-health" },
  { name: "endfield", origin: process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176", path: "/settings" },
];
for (const app of apps) {
  if (!["127.0.0.1", "localhost"].includes(new URL(app.origin).hostname)) throw new Error("Local-only test");
}
const browser = await chromium.launch({ headless: true });
const user = { id: "auth-experience-fixture", name: "弹窗测试", email: "auth@example.invalid" };
const password = "Axy123!?";
const deferred = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};

async function fixture(app, viewport = { width: 1440, height: 900 }, locale = "zh", theme = "light") {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.addCookies(["riic-locale", "riic-endfield-locale"].map(name => ({ name, value: locale, url: app.origin })));
  await context.addInitScript(theme => {
    globalThis.localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
    globalThis.localStorage.setItem("riic-color-mode", theme);
  }, theme);
  const state = { signedIn: false, failSession: false, signInCode: "INVALID_EMAIL_OR_PASSWORD", failResend: false, resetCode: null, resetGate: null, signupGate: null };
  const requests = [];
  // Block every real API request: these flows never send email or modify an account.
  await context.route("**/api/**", route => route.fulfill({ status: 401, json: { error: { message: "Isolated fixture" } } }));
  await context.route("**/api/releases*", route => route.fulfill({ json: { success: true, data: { environment: "local", releases: [] } } }));
  await context.route("**/api/account/feature-access", route => route.fulfill({ json: { agent: false, billing: false } }));
  await context.route("**/api/auth/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/get-session")) return route.fulfill(state.signedIn && state.failSession
      ? { status: 503, json: { message: "Fixture session unavailable" } }
      : { json: state.signedIn ? { user, session: { expiresAt: "2099-01-01T00:00:00Z" } } : null });
    requests.push({ path, body: route.request().postDataJSON() });
    if (path.endsWith("/sign-in/email")) {
      if (state.signInCode) return route.fulfill({ status: 403, json: { code: state.signInCode, message: "Raw server diagnostic must not be shown" } });
      state.signedIn = true;
    }
    if (path.endsWith("/send-verification-otp") && state.failResend) return route.fulfill({ status: 503, json: { message: "Raw mail transport diagnostic" } });
    if (path.endsWith("/request-password-reset") && state.resetGate) await state.resetGate.promise;
    if (path.endsWith("/sign-up/email") && state.signupGate) await state.signupGate.promise;
    if (path.endsWith("/reset-password")) {
      if (state.resetCode) return route.fulfill({ status: 400, json: { code: state.resetCode, message: "Invalid token" } });
      state.signedIn = false;
    }
    return route.fulfill({ json: { success: true } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const dialog = page.locator("[data-website-account-dialog]");
  const open = async (query = "auth=signin") => {
    await page.goto(`${app.origin}${app.path}?${query}`);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-website-account-dialog-loading]")).toHaveCount(0);
  };
  return { context, state, requests, page, dialog, errors, open };
}

async function fillSignIn(dialog) {
  await dialog.getByLabel("邮箱", { exact: true }).fill(user.email);
  await dialog.getByLabel("密码", { exact: true }).fill(password);
}

async function checkBounds(page, dialog) {
  const viewport = page.viewportSize();
  await expect(async () => {
    // Sample one layout frame so a flow transition cannot mix old and new bounds.
    const { bounds, action, fits } = await dialog.evaluate(el => ({
      bounds: el.getBoundingClientRect().toJSON(),
      action: el.querySelector("[data-auth-actions]")?.getBoundingClientRect().toJSON(),
      fits: el.scrollWidth <= el.clientWidth,
    }));
    const diagnostic = JSON.stringify({ viewport, bounds, action });
    assert.ok(bounds.width <= 461, `Login stays compact: ${diagnostic}`);
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= viewport.width + 1 && bounds.bottom <= viewport.height + 1, `Dialog fits the viewport: ${diagnostic}`);
    assert.equal(fits, true, "No horizontal overflow");
    assert.ok(action && action.y >= bounds.y && action.bottom <= bounds.bottom + 1, `Actions remain visible while fields scroll: ${diagnostic}`);
  }).toPass({ timeout: 5000 });
  await checkAuthActions(dialog);
}

async function checkAuthActions(dialog) {
  const footer = dialog.locator("[data-auth-actions]");
  const layout = await footer.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    const style = globalThis.getComputedStyle(el);
    return {
      left: bounds.left + Number.parseFloat(style.paddingLeft),
      right: bounds.right - Number.parseFloat(style.paddingRight),
      buttons: [...el.querySelectorAll("button")].map(button => ({
        ...button.getBoundingClientRect().toJSON(),
        layoutHeight: button.offsetHeight,
        role: button.getAttribute("data-auth-action"),
        label: button.textContent,
      })),
    };
  });
  assert.equal(layout.buttons.at(-1)?.role, "primary", "Primary action comes last");
  for (const [index, button] of layout.buttons.entries()) {
    assert.ok(button.role, "Every flow action uses the shared button");
    assert.ok(button.layoutHeight >= 44 && button.left >= layout.left - 1 && button.right <= layout.right + 1, `Action fits and remains tappable: ${JSON.stringify(layout)}`);
    const next = layout.buttons[index + 1];
    if (!next || Math.abs(next.top - button.top) > 2) assert.ok(Math.abs(button.right - layout.right) < 2, `Each action row aligns right: ${JSON.stringify(layout)}`);
  }
}

async function checkSignInActions(dialog) {
  const footer = dialog.locator("[data-auth-actions]");
  const buttons = footer.getByRole("button");
  await expect(buttons).toHaveCount(2);
  const create = await buttons.nth(0).boundingBox();
  const submit = await buttons.nth(1).boundingBox();
  const row = await footer.boundingBox();
  const padding = await footer.evaluate(el => Number.parseFloat(globalThis.getComputedStyle(el).paddingRight));
  assert.ok(Math.abs(create.y - submit.y) < 2 && create.x + create.width < submit.x, "Create account and sign in share one row");
  assert.ok(Math.abs(submit.x + submit.width - (row.x + row.width - padding)) < 2, "Sign-in actions align to the right edge");
}

async function checkActionTheme(dialog, app, theme) {
  const primary = dialog.locator('[data-auth-actions] [data-auth-action="primary"]');
  const colors = await primary.evaluate(el => {
    const ctx = globalThis.document.createElement("canvas").getContext("2d");
    const brightness = color => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return (r + g + b) / (3 * 255);
    };
    return {
      text: brightness(globalThis.getComputedStyle(el.querySelector(".ef-action-label") ?? el).color),
      background: brightness(globalThis.getComputedStyle(el).backgroundColor),
    };
  });
  assert.ok(theme === "dark" ? colors.text < 0.3 : colors.text > 0.9, `Primary label inverts with the theme: ${JSON.stringify(colors)}`);
  if (app.name === "endfield") {
    await expect(primary).toHaveClass(theme === "dark" ? /ef-action--white/ : /ef-action--dark/);
    await expect(dialog.locator('[data-auth-actions] [data-auth-action="secondary"]').first()).toHaveClass(theme === "dark" ? /ef-action--dark/ : /ef-action--white/);
  } else {
    assert.ok(theme === "dark" ? colors.background > 0.85 : colors.background < 0.2, `Primary background inverts with the theme: ${JSON.stringify(colors)}`);
  }
}

try {
  for (const app of apps) {
    const f = await fixture(app);
    const { page, dialog, state, requests } = f;
    try {
      await f.open();
      await expect(dialog).toHaveAccessibleName("登录网站账号");
      await expect(dialog.getByRole("button", { name: "验证邮箱", exact: true })).toHaveCount(0);
      if (app.name === "endfield") {
        await expect(dialog).toHaveClass(/ef-dialog/);
        await expect(dialog.locator(".ef-dialog-header .ef-dialog-close-glyph")).toHaveCount(1);
        await expect(dialog.locator("[data-auth-actions] .ef-action")).toHaveCount(2);
      }
      await checkSignInActions(dialog);
      await checkAuthActions(dialog);
      await checkActionTheme(dialog, app, "light");
      await fillSignIn(dialog);
      await dialog.getByLabel("密码", { exact: true }).press("Enter");
      await expect(dialog.getByRole("alert")).toContainText("邮箱或密码不正确");
      await expect(dialog).not.toContainText("Raw server diagnostic");
      state.signInCode = "EMAIL_NOT_VERIFIED";
      await dialog.getByRole("button", { name: "登录", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "发送验证码", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "已有验证码", exact: true }).click();
      await expect(dialog).toHaveAccessibleName("输入邮箱验证码");
      await checkAuthActions(dialog);
      const digits = dialog.locator('[autocomplete="one-time-code"]').locator("xpath=..").locator("xpath=..").locator("input");
      await expect(digits).toHaveCount(6);
      await digits.nth(0).fill("123456");
      state.failResend = true;
      await dialog.getByRole("button", { name: "重新发送验证码", exact: true }).click();
      const alert = dialog.getByRole("alert");
      await expect(alert).toContainText("暂时无法完成操作");
      assert.ok((await alert.boundingBox()).width > 100, "Resend failure is visually displayed");
      assert.equal((await digits.evaluateAll(inputs => inputs.map(input => input.value))).join(""), "123456", "Failed resend preserves the code");
      await dialog.getByRole("button", { name: "验证邮箱", exact: true }).click();
      await expect(dialog).toHaveAccessibleName("邮箱验证完成");
      await checkAuthActions(dialog);
      await dialog.getByRole("button", { name: "返回登录", exact: true }).click();
      await expect(dialog.getByLabel("邮箱", { exact: true })).toHaveValue(user.email);
      console.log(`${app.name}: localized errors and visible resend recovery passed`);

      await dialog.getByRole("button", { name: "忘记密码", exact: true }).click();
      await checkAuthActions(dialog);
      state.resetGate = deferred();
      state.signupGate = deferred();
      await dialog.getByRole("button", { name: "发送重置邮件", exact: true }).click();
      await expect.poll(() => requests.filter(r => r.path.endsWith("/request-password-reset")).length).toBe(1);
      await dialog.getByRole("button", { name: "创建账号", exact: true }).click();
      await dialog.getByLabel("昵称").fill(user.name);
      await dialog.getByLabel("密码", { exact: true }).fill(password);
      await dialog.getByLabel("确认密码", { exact: true }).fill(password);
      await dialog.getByRole("button", { name: "创建账号并发送验证码", exact: true }).click();
      await expect.poll(() => requests.filter(r => r.path.endsWith("/sign-up/email")).length).toBe(1);
      state.resetGate.release();
      await expect(dialog).toHaveAccessibleName("创建网站账号");
      await expect(dialog.getByRole("button", { name: "正在处理…", exact: true })).toBeDisabled();
      state.signupGate.release();
      await expect(dialog).toHaveAccessibleName("输入邮箱验证码");
      console.log(`${app.name}: stale responses cannot change the new flow or release its busy state`);

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      const avatar = page.locator("[data-sidebar-account-trigger]");
      await expect(avatar).toBeFocused();
      await avatar.click();
      await fillSignIn(dialog);
      state.signInCode = null;
      state.failSession = true;
      const signIns = requests.filter(r => r.path.endsWith("/sign-in/email")).length;
      await dialog.getByRole("button", { name: "登录", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("无需再次输入密码");
      await checkAuthActions(dialog);
      state.failSession = false;
      await dialog.getByRole("button", { name: "重试登录状态", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(avatar).toContainText(user.name);
      await expect(avatar).toBeFocused();
      assert.equal(requests.filter(r => r.path.endsWith("/sign-in/email")).length, signIns + 1);
      assert.equal(page.url(), `${app.origin}${app.path}`);
      console.log(`${app.name}: session retry keeps credentials out of repeat requests and restores focus`);

      state.resetCode = "INVALID_TOKEN";
      await f.open("auth=reset-password&token=expired-fixture");
      await checkAuthActions(dialog);
      await dialog.getByLabel("新密码", { exact: true }).fill(password);
      await dialog.getByLabel("确认新密码", { exact: true }).fill(password);
      await dialog.getByLabel("确认新密码", { exact: true }).press("Enter");
      await expect(dialog.getByRole("alert")).toContainText("重置链接已失效");
      await checkAuthActions(dialog);
      await dialog.getByRole("button", { name: "重新发送重置邮件", exact: true }).click();
      await expect(dialog).toHaveAccessibleName("找回密码");
      await expect(dialog.getByLabel("邮箱", { exact: true })).toBeVisible();
      state.resetCode = null;
      await f.open("auth=reset-password&token=valid-fixture");
      await dialog.getByLabel("新密码", { exact: true }).fill(password);
      await dialog.getByLabel("确认新密码", { exact: true }).fill(password);
      await dialog.getByLabel("确认新密码", { exact: true }).press("Enter");
      await expect(dialog).toHaveAccessibleName("密码已重置");
      await checkAuthActions(dialog);
      await expect(dialog.locator("input")).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "确认重置", exact: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: "使用新密码登录", exact: true }).click();
      await expect(dialog).toHaveAccessibleName("登录网站账号");
      state.failSession = true;
      await fillSignIn(dialog);
      await dialog.getByRole("button", { name: "登录", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "重试登录状态", exact: true })).toBeVisible();
      state.failSession = false;
      await dialog.getByRole("button", { name: "重试登录状态", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      assert.deepEqual(f.errors, []);
      console.log(`${app.name}: reset Enter submission, expired-link recovery and completion passed`);
    } catch (error) {
      console.error({ app: app.name, url: page.url(), pageErrors: f.errors, dialogs: await dialog.allTextContents() });
      throw error;
    } finally {
      state.resetGate?.release();
      state.signupGate?.release();
      await f.context.close();
    }

    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 480 }]) {
      const small = await fixture(app, viewport);
      try {
        await small.open();
        await expect(small.dialog.getByLabel("邮箱", { exact: true })).toBeVisible();
        await checkBounds(small.page, small.dialog);
        await checkSignInActions(small.dialog);
        await small.dialog.getByRole("button", { name: "创建账号", exact: true }).click();
        await expect(small.dialog).toHaveAccessibleName("创建网站账号");
        await checkBounds(small.page, small.dialog);
        await small.dialog.getByLabel("昵称").fill(user.name);
        await small.dialog.getByLabel("邮箱", { exact: true }).fill(user.email);
        await small.dialog.getByLabel("密码", { exact: true }).fill(password);
        await small.dialog.getByLabel("确认密码", { exact: true }).fill(password);
        await small.dialog.getByRole("button", { name: "创建账号并发送验证码", exact: true }).click();
        await expect(small.dialog).toHaveAccessibleName("输入邮箱验证码");
        await checkBounds(small.page, small.dialog);
        assert.equal(await small.dialog.locator('[role="group"]').evaluate(el => el.scrollWidth <= el.clientWidth), true, "OTP fits the narrow dialog");
        assert.deepEqual(small.errors, []);
        console.log(`${app.name}: ${viewport.width}x${viewport.height} login, registration and OTP bounds passed`);
      } finally { await small.context.close(); }
    }

    const english = await fixture(app, { width: 1440, height: 900 }, "en");
    try {
      await english.open();
      await checkSignInActions(english.dialog);
      await english.dialog.getByLabel("Email", { exact: true }).fill(user.email);
      await english.dialog.getByLabel("Password", { exact: true }).fill(password);
      await english.dialog.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(english.dialog.getByRole("alert")).toContainText("The email or password is incorrect");
      await expect(english.dialog.getByRole("button", { name: "Close", exact: true })).toBeVisible();
      assert.deepEqual(english.errors, []);
      console.log(`${app.name}: English errors and close label passed`);
    } finally { await english.context.close(); }

    const dark = await fixture(app, { width: 320, height: 480 }, "en", "dark");
    try {
      await dark.open();
      await expect(dark.page.locator("html")).toHaveClass(/dark/);
      await checkActionTheme(dark.dialog, app, "dark");
      await checkBounds(dark.page, dark.dialog);
      await dark.dialog.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(dark.dialog.getByLabel("Display name", { exact: true })).toBeVisible();
      await checkBounds(dark.page, dark.dialog);
      await dark.dialog.getByRole("button", { name: "I have an account", exact: true }).click();
      await dark.dialog.getByRole("button", { name: "Forgot password", exact: true }).click();
      await checkBounds(dark.page, dark.dialog);
      await dark.dialog.getByLabel("Email", { exact: true }).fill(user.email);
      await dark.dialog.getByRole("button", { name: "Send reset email", exact: true }).click();
      await expect(dark.dialog.locator("[data-auth-step]")).toHaveAttribute("data-auth-step", "complete");
      await checkBounds(dark.page, dark.dialog);
      await dark.open("auth=reset-password&token=dark-fixture");
      await checkBounds(dark.page, dark.dialog);
      assert.deepEqual(dark.errors, []);
      console.log(`${app.name}: dark primary action and narrow English follow-up actions passed`);
    } finally { await dark.context.close(); }
  }
} finally { await browser.close(); }
