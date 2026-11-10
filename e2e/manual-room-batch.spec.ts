import fullRoster from "../fixtures/operbox_full_e2.json" with { type: "json" };
import operatorCatalog from "@riic/arknights-domain/generated/arkntools/operator-catalog.json" with { type: "json" };
import { test, expect } from "@playwright/test";
import layout243 from "@riic/arknights-domain/layouts/243.json" with { type: "json" };
import { mockApis, now } from "./production-readiness.fixture";
const operators = [
  { id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 6, rarity: 5 },
  { id: "char_300_phenxi", name: "菲亚梅塔", elite: 2, level: 60, own: true, potential: 1, rarity: 6 },
  { id: "char_348_ceylon", name: "锡兰", elite: 2, level: 60, own: true, potential: 1, rarity: 5 },
];

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.addInitScript(({ layout, operbox, savedAt, expiresAt }) => {
    window.localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
    window.localStorage.setItem("arknights-infra-calc-session-v5", JSON.stringify({
      version: 5,
      savedAt,
      expiresAt,
      presetLabel: "243",
      layout,
      operbox,
      sourceName: "手动排班测试样例",
      boxSource: "sample",
      layoutDirty: false,
      layoutSource: "local",
      localLayoutBackup: null,
      rotationProfile: "abc_12_6_6",
      fiammettaEnabled: false,
      result: null,
      activeShift: 0,
    }));
  }, {
    layout: layout243,
    operbox: operators,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
});

test("room batch selection saves ordered crew and cancel preserves the room", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/manual");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  const room = page.locator('[data-manual-editor-board]');
  await room.getByRole("button", { name: "空置", exact: true }).first().click();
  const originalDialog = await page.getByRole('dialog').elementHandle();
  await page.getByRole('dialog').screenshot({path:'outputs/arknights-batch-entry.png'});
  await page.locator('[data-room-batch-open]').click();
  expect(await originalDialog!.evaluate(node => node.isConnected)).toBe(true);
  const picker = page.getByRole("dialog");
  await picker.getByText("全部", { exact: true }).first().click();
  const search = picker.getByRole("textbox").first();
  for (const name of ["阿米娅", "菲亚梅塔"]) {
    await search.fill(name);
    await picker.getByRole("button", { name: new RegExp(name) }).click();
  }
  await search.fill("");
  await page.mouse.move(930, 70);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await picker.screenshot({ path: "outputs/arknights-room-batch.png" });
  await picker.getByRole("button", { name: "确认选择", exact: true }).click();
  const savedCrew = () => page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-manual-schedule-v1")!).shifts[0].rooms.control.operators);
  await expect.poll(savedCrew).toEqual(["阿米娅", "菲亚梅塔", null, null, null]);
  await room.getByRole("button", { name: /阿米娅/ }).first().click();
  await page.locator('[data-room-batch-open]').click();
  await search.fill("阿米娅");
  await picker.getByRole("button", { name: /阿米娅/ }).click();
  await picker.getByRole("button", { name: "取消", exact: true }).click();
  expect(await savedCrew()).toEqual(["阿米娅", "菲亚梅塔", null, null, null]);
  await page.reload();
  await expect(room.locator('[data-operator-identity="菲亚梅塔"]')).toBeVisible();
});



test("room multiselect lists every matching owned operator including assigned crew", async ({ page }) => {
  await page.addInitScript(roster => {
    const key = "arknights-infra-calc-session-v5";
    const session = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...session, operbox: roster }));
  }, fullRoster);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/manual");
  await page.locator('[data-manual-editor-board]').getByRole("button", { name: "空置", exact: true }).first().click();
  await page.locator('[data-room-batch-open]').click();
  const expected = operatorCatalog.filter(op => op.buildingSkills.some(skill => skill.id.startsWith("control_"))).length;
  expect(expected).toBeGreaterThan(24);
  await expect(page.locator('[data-manual-operator-choice]')).toHaveCount(expected);
  await page.getByRole('dialog').screenshot({path:'outputs/arknights-all-room-candidates.png'});
});
