import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./production-readiness.fixture";

test.describe.configure({ timeout: 90_000 });

const account = (id: string) => ({
  user: { id, name: id, email: `${id}@example.test` },
  session: { expiresAt: "2099-01-01T00:00:00Z" },
});

async function prepare(page: Page) {
  const state = {
    session: account("focus-user") as ReturnType<typeof account> | null,
    allowed: true,
    sessionReads: 0,
    featureReads: 0,
  };
  // Keep these browser regressions independent of real accounts and AI credits.
  await page.route("**/api/**", route => route.fulfill({ status: 401, json: { error: "Isolated fixture" } }));
  await mockApis(page);
  await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "static"));
  await page.route("**/api/auth/get-session", route => {
    state.sessionReads++;
    return route.fulfill({ json: state.session });
  });
  await page.route("**/api/account/feature-access", route => {
    state.featureReads++;
    const allowed = state.allowed && state.session !== null;
    return route.fulfill({ json: { agent: allowed, billing: allowed } });
  });
  await page.route("**/api/account/data-consent", route => route.fulfill({ json: { success: true, data: { current: false, cloudSyncEnabled: false } } }));
  await page.route("**/api/agent/chat", route => route.fulfill({ json: {
    success: true, data: { enabled: true, provider: "deepseek", model: "fixture" },
  } }));
  return state;
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function focus(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

for (const width of [1440, 375]) {
  for (const mode of ["Agent page", "Floating assistant", "Restored assistant"]) {
    test(`${mode} keeps its draft and mounted chat during focus refresh at ${width}px`, async ({ page }) => {
      const floating = mode !== "Agent page";
      const state = await prepare(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(floating ? "/account-health" : "/agent");
      await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 45_000 });
      await expect.poll(() => state.sessionReads).toBeGreaterThan(0);
      if (floating) {
        if (mode === "Restored assistant") {
          await page.getByRole("button", { name: "收起悬浮助理", exact: true }).click();
          await page.locator("[data-agent-dock-trigger]").click();
        } else {
          await page.locator("[data-agent-floating-trigger]").click();
        }
        await expect(page.locator("[data-agent-dock-trigger]")).toBeVisible();
        await expect(page.locator("[data-agent-floating-trigger] img")).toBeVisible();
      }
      const input = page.locator("[data-agent-chat] textarea");
      await input.fill("Keep this unsent message");
      const chat = await page.locator("[data-agent-chat]").elementHandle();
      expect(chat).not.toBeNull();
      let navigations = 0;
      page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });

      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let completed = 0;
      await page.route("**/api/auth/get-session", async route => {
        state.sessionReads++;
        await gate;
        await route.fulfill({ json: state.session });
        completed++;
      });
      const reads = state.sessionReads;
      const featureReads = state.featureReads;
      try {
        for (let count = 1; count <= 3; count++) {
          await focus(page);
          await expect.poll(() => state.sessionReads).toBe(reads + count);
          await settle(page);
          expect(await chat!.evaluate(node => node.isConnected), "Refresh must not unmount the current chat").toBe(true);
          await expect(input).toHaveValue("Keep this unsent message");
          if (floating) await expect(page.locator("[data-agent-floating-panel]")).toBeVisible();
        }
      } finally {
        release();
      }
      await expect.poll(() => completed).toBe(3);
      await expect.poll(() => state.featureReads).toBeGreaterThan(featureReads);
      await settle(page);
      expect(await chat!.evaluate(node => node.isConnected)).toBe(true);
      await expect(input).toHaveValue("Keep this unsent message");
      expect(navigations).toBe(0);
    });
  }
}

test("Focus refresh still applies permission revocation, account changes and cross-tab logout", async ({ page }) => {
  const state = await prepare(page);
  await page.goto("/agent");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 45_000 });
  const input = page.locator("[data-agent-chat] textarea");
  const name = page.locator("[data-sidebar-account-name]");
  await expect(name).toHaveText("focus-user");
  await input.fill("Private draft for the first account");

  state.session = account("second-user");
  await focus(page);
  await expect(name).toHaveText("second-user");
  await expect(input).toHaveValue("");

  state.allowed = false;
  await focus(page);
  await expect(page.locator("[data-agent-chat]")).toHaveCount(0);
  state.allowed = true;
  await focus(page);
  await expect(input).toBeVisible();

  state.session = null;
  await focus(page);
  await expect(name).not.toHaveText("second-user");
  await expect(page.locator("[data-agent-chat]")).toHaveCount(0);
});
