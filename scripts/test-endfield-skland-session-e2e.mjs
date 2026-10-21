import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { catalog, STORAGE_KEY } from "../packages/endfield-solver/model.mjs";

const origin = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local-only test");
const role = owner => ({ uid: owner, roleId: owner, serverId: "server", nickname: owner, serverName: "Server", isDefault: true });
const snapshot = owner => ({ game: "endfield", role: { ...role(owner), name: owner, level: 1 },
  characters: catalog.slice(owner === "owner-a" ? 0 : 8, owner === "owner-a" ? 8 : 16).map(op => ({ id: op.id, name: op.name, elite: 2, level: 60 })),
  rosterComplete: true, facilitiesComplete: true, fetchedAt: 1,
  rooms: [{ id: "center", type: 0, level: 1 }, { id: "m1", type: 1, level: 1 }, { id: "m2", type: 1, level: 1 }],
});
const browser = await chromium.launch({ headless: true });
let owner = "owner-a", delay = null, release, syncStarted;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "riic-endfield-locale", value: "en", url: origin }]);
  await context.route("**/api/auth/get-session**", route => route.fulfill({ json: owner ? { user: { id: owner, name: owner, email: `${owner}@example.invalid` }, session: { expiresAt: "2099-01-01" } } : null }));
  await context.route("**/api/skland/*", async route => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    const capturedOwner = owner;
    if (!capturedOwner) return route.fulfill({ status: 401, json: { success: false, error: { message: "Signed out" } } });
    const data = action === "accounts" ? { accounts: [{ id: "shared-account-id", label: capturedOwner, source: "endfield" }], ownerKey: capturedOwner }
      : action === "roles" ? { roles: [role(capturedOwner)] } : { snapshot: snapshot(capturedOwner) };
    if (action === "sync" && delay) { syncStarted(); await delay; }
    await route.fulfill({ json: { success: true, data } }).catch(() => {});
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const profile = name => page.locator(".ef-skland-profile h2").filter({ hasText: name });
  const idle = () => page.locator('[data-endfield-skland][aria-busy="false"]').waitFor();
  const roster = () => page.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key))?.operators ?? [], STORAGE_KEY);
  const expected = name => snapshot(name).characters.map(({ name, elite }) => ({ name, elite }));
  const focus = () => page.evaluate(() => globalThis.window.dispatchEvent(new Event("focus")));
  const pendingRefresh = async () => {
    delay = new Promise(resolve => { release = resolve; });
    const request = new Promise(resolve => { syncStarted = resolve; });
    await page.getByRole("button", { name: "Refresh data", exact: true }).click();
    await request;
    delay = null;
  };
  await page.goto(`${origin}/skland`);
  await expect(profile("owner-a")).toBeVisible(); await idle();
  await focus();
  await expect(page.locator("[data-sidebar-account-name]")).toHaveText("owner-a");
  await idle();
  await expect.poll(roster).toEqual(expected("owner-a"));
  await pendingRefresh();
  owner = "owner-b";
  await focus();
  await expect(profile("owner-b")).toBeVisible(); await idle();
  release();
  await expect.poll(roster).toEqual(expected("owner-b"));
  await page.getByRole("link", { name: "Auto schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate schedule", exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "Skland sync", exact: true }).click(); await idle();
  await expect.poll(roster).toEqual(expected("owner-b"));
  await pendingRefresh();
  owner = null;
  await focus();
  await expect(page.getByRole("heading", { name: "Connect to Skland", exact: true })).toBeVisible();
  release(); await idle();
  assert.equal(await page.locator("[data-skland-data]").count(), 0);
  assert.deepEqual(await roster(), expected("owner-b"), "Cross-tab logout preserves the last local draft without accepting an old response");
  assert.deepEqual(errors, []);
  console.log("Passed: website owner changes and cross-tab logout cancel in-flight Skland sync; stale responses cannot restore the previous account. Mock data only.");
} finally { release?.(); await browser.close(); }
