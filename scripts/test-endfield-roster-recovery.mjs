import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY } from "@riic/endfield-solver/model.mjs";
import { unlockedSkillNodes } from "@riic/endfield-skland/skill-nodes";

const origin = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
const entry = process.env.ENDFIELD_E2E_ENTRY || origin;
for (const address of [origin, entry]) if (!["127.0.0.1", "localhost"].includes(new URL(address).hostname)) throw new Error("Local preview only");
const role = { uid: "fixture", roleId: "fixture-role", serverId: "fixture-server", nickname: "Fixture", serverName: "Test", isDefault: true };
const snapshot = {
  game: "endfield", role: { roleId: role.roleId, name: "Fixture", serverName: "Test", level: 1 },
  characters: catalog.slice(0, 2).map((op, index) => ({ id: op.id, name: op.name, elite: index + 1, level: 20, latestSpaceshipSkillNodes: [] })),
  rosterComplete: true, facilitiesComplete: true, fetchedAt: 1,
  rooms: [{ id: "center", type: 0, level: 1 }, { id: "m1", type: 1, level: 1 }, { id: "m2", type: 1, level: 1 }],
};
const expected = snapshot.characters.map(({ name, elite, latestSpaceshipSkillNodes }) => ({ name, elite, latestSpaceshipSkillNodes }));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (entry === origin) await context.route("**/api/auth/get-session**", route => route.fulfill({ json: null }));
  // All Skland requests are synthetic. No connected game account is read or changed.
  await context.route("**/api/skland/**", route => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    const data = action === "accounts" ? { ownerKey: "fixture-owner", accounts: [{ id: "fixture-account", label: "Fixture", source: "endfield" }] }
      : action === "roles" ? { roles: [role] } : action === "sync" ? { snapshot } : null;
    return route.fulfill({ status: data ? 200 : 400, json: { success: !!data, data } });
  });
  await context.addCookies([{ name: "riic-endfield-locale", value: "zh", url: origin }]);
  await context.addInitScript(({ origin, key, options }) => {
    if (globalThis.location.origin !== origin || sessionStorage.getItem("roster-recovery-seeded")) return;
    localStorage.setItem(key, JSON.stringify({ version: 1, operators: [], options }));
    sessionStorage.setItem("roster-recovery-seeded", "1");
  }, { origin, key: STORAGE_KEY, options: DEFAULT_OPTIONS });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  const openRoster = async () => {
    await page.getByRole("button", { name: "编辑名单", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "我的干员", exact: true });
    await expect(dialog.locator(".ef-roster-card")).toHaveCount(catalog.length);
    return dialog;
  };
  const upgrade = async (dialog, all) => {
    await dialog.getByRole("button", { name: "全精4 · 技能全解锁", exact: true }).click();
    await dialog.getByRole("button", { name: all ? /^获取所有干员并且全精4/ : /^仅改变已拥有的状态/ }).click();
    await expect(dialog.getByRole("group", { name: "选择升级范围" })).toBeHidden();
  };
  await page.goto(entry);
  await page.goto(`${origin}/manual`);
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  let dialog = await openRoster();
  await expect(dialog.getByRole("button", { name: "恢复森空岛数据", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "全精4 · 技能全解锁", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /^仅改变已拥有的状态/ })).toBeDisabled();
  await dialog.getByRole("button", { name: /^获取所有干员并且全精4/ }).click();
  await expect.poll(async () => (await read()).operators.length).toBe(catalog.length);
  for (const op of (await read()).operators) {
    const skills = catalog.find(item => item.name === op.name).skills;
    assert.equal(op.elite, 4);
    assert.equal(unlockedSkillNodes(skills, op).length, skills.length);
  }
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await page.goto(origin);
  await page.locator(".ef-actions").getByRole("link", { name: "森空岛同步", exact: true }).click();
  await expect.poll(async () => (await read()).sklandRoster).toEqual(expected);
  await page.goto(`${origin}/manual`);
  dialog = await openRoster();
  await upgrade(dialog, false);
  await expect.poll(async () => (await read()).operators.map(op => op.elite)).toEqual([4, 4]);
  await upgrade(dialog, true);
  await expect.poll(async () => (await read()).operators.length).toBe(catalog.length);
  await dialog.getByRole("button", { name: `拥有${catalog[0].name}`, exact: true }).click();
  await expect.poll(async () => (await read()).operators.length).toBe(catalog.length - 1);
  await page.reload();
  dialog = await openRoster();
  assert.deepEqual((await read()).sklandRoster, expected, "editing and reloading preserve the sync baseline");
  await dialog.getByRole("button", { name: "恢复森空岛数据", exact: true }).click();
  await expect.poll(async () => (await read()).operators).toEqual(expected);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(dialog.getByRole("button", { name: "恢复森空岛数据", exact: true })).toBeInViewport();
    assert.ok(await dialog.evaluate(el => el.scrollWidth - el.clientWidth <= 1), `Dialog must fit at ${width}px`);
  }
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await page.goto(`${origin}/manual?view=simulation`);
  dialog = await openRoster();
  await expect(dialog.getByRole("button", { name: "恢复森空岛数据", exact: true })).toBeEnabled();
  await page.evaluate(() => globalThis.dispatchEvent(new Event("riic:endfield:session-change")));
  await expect(dialog.getByRole("button", { name: "恢复森空岛数据", exact: true })).toBeDisabled();
  await expect.poll(async () => (await read()).sklandRoster).toBeUndefined();
  // A repeat sync must save the baseline even when solver inputs did not change.
  await page.goto(`${origin}/skland`);
  await expect.poll(async () => (await read()).sklandRoster).toEqual(expected);
  await page.goto(origin);
  dialog = await openRoster();
  await expect(dialog.getByRole("button", { name: "恢复森空岛数据", exact: true })).toBeEnabled();
  assert.deepEqual(errors, []);
  console.log("Roster recovery E2E passed: manual and automatic entries, both max-roster scopes, mocked Skland sync, reload recovery, responsive footer and session isolation.");
} finally {
  await browser.close();
}
