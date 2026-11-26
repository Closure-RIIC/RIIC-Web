import { expect, test } from "@playwright/test";
import { switchWorkbenchLanguage } from "./workbench-language";
import layout from "@riic/arknights-domain/layouts/243.json" with {type:"json"};
import { mockApis, mockSignedInWebsiteSession } from "./production-readiness.fixture";
import { sessionPayload, sessionStorageKey } from "./session";

test.beforeEach(async ({page}) => {
  await mockApis(page);
  await mockSignedInWebsiteSession(page);
  const seededSession = sessionPayload({
    layout,
    operbox: [
      {id:"char_002_amiya",name:"阿米娅",elite:2,level:80,own:true,potential:1,rarity:5},
      {id:"char_300_phenxi",name:"菲亚梅塔",elite:2,level:60,own:true,potential:1,rarity:6},
      {id:"char_348_ceylon",name:"锡兰",elite:2,level:60,own:true,potential:1,rarity:5},
    ],
    sourceName:"Mood test", fiammettaEnabled:true,
  });
  await page.addInitScript(({key,seededSession}) => {
    if (localStorage.getItem("mood-e2e-seeded")) return;
    localStorage.setItem("mood-e2e-seeded","1");
    localStorage.setItem("arknights-infra-calc-beta-onboarding-v1","1");
    localStorage.setItem(key,JSON.stringify(seededSession));
    localStorage.setItem("arknights-infra-manual-schedule-v1",JSON.stringify({
      version:3,scheduleMode:"sequential",externalOperatorNames:[],startTime:"08:00",activeShift:0,fiammettaEnabled:true,
      shifts:[{durationHours:12,fiammettaTarget:"阿米娅",droneTargetRoomId:null,rooms:{trade_1:{operators:["阿米娅"]},dorm_1:{operators:["菲亚梅塔","锡兰"]}}},
        {durationHours:12,fiammettaTarget:"锡兰",droneTargetRoomId:null,rooms:{trade_1:{operators:["锡兰"]},dorm_1:{operators:["菲亚梅塔"]}}}],
    }));
  },{key:sessionStorageKey,seededSession});
});

test("manual dorm locks stay on the same empty and occupied beds after switching shifts and reloading", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/manual");
  const panel = page.locator("[data-mood-simulation]");
  const play = panel.getByRole("button", { name: "开始播放", exact: true });
  await expect(play).toBeEnabled({ timeout: 60_000 });
  await page.evaluate(() => {
    const key = "arknights-infra-manual-schedule-v1";
    const draft = JSON.parse(localStorage.getItem(key)!);
    draft.shifts[1].rooms = {
      trade_1: { operators: ["菲亚梅塔"] },
      dorm_1: { operators: ["阿米娅", null, "锡兰"] },
    };
    localStorage.setItem(key, JSON.stringify(draft));
  });
  await page.reload();
  await expect(play).toBeEnabled({ timeout: 60_000 });
  const board = page.locator("[data-manual-editor-board]:visible");
  const dorm = board.locator('[data-schedule-room="dorm_1"]');
  const trade = board.locator('[data-schedule-room="trade_1"]');
  const fiammetta = dorm.locator('[data-operator-identity="菲亚梅塔"]');
  const bedToggles = dorm.locator("[data-dorm-slot-toggle]");
  await expect(bedToggles).toHaveCount(5);
  await bedToggles.nth(0).click();
  await bedToggles.nth(2).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(bedToggles.nth(0)).toHaveAccessibleName("解锁此床位");
  await expect(bedToggles.nth(2)).toHaveAttribute("aria-pressed","true");
  await expect(dorm.locator("[data-dorm-slot-locked]")).toHaveCount(2);

  const view = board.locator("[data-schedule-view-controls]");
  const overview = view.getByRole("tab", { name: "一图流布局" });
  const list = view.getByRole("tab", { name: "列表式布局" });
  await overview.click();
  await expect(bedToggles.nth(2)).toHaveAttribute("aria-pressed", "true");
  await bedToggles.nth(2).click();
  await expect(bedToggles.nth(2)).toHaveAttribute("aria-pressed", "false");
  await bedToggles.nth(2).click();
  await list.click();
  await board.locator("[data-shift-tabs]").getByRole("tab").nth(1).click();
  await expect(dorm.locator("[data-dorm-slot-locked]")).toHaveCount(2);
  await expect(fiammetta).toBeVisible();
  await expect(trade.locator('[data-operator-identity="菲亚梅塔"]')).toHaveCount(0);
  await page.reload();
  await expect(dorm.locator("[data-dorm-slot-locked]")).toHaveCount(2);
  await bedToggles.nth(0).click();
  await expect(dorm.locator("[data-dorm-slot-locked]")).toHaveCount(1);
  await expect(bedToggles.nth(0)).toHaveAccessibleName("锁定此床位");
  await expect(trade.locator('[data-operator-identity="菲亚梅塔"]')).toBeVisible();
  await expect(dorm.locator('[data-operator-identity="阿米娅"]')).toBeVisible();
  await expect(dorm.locator('[data-operator-identity="锡兰"]')).toHaveCount(0);
  await bedToggles.nth(2).click();
  await expect(dorm.locator('[data-operator-identity="锡兰"]')).toBeVisible();
  await expect(play).toBeEnabled();
  await panel.getByRole("tab", { name: "心情回放", exact: true }).click();
  await expect(panel.getByLabel("模拟时间轴")).toHaveValue("12");
  await expect(dorm.locator('[data-operator-identity="阿米娅"]')).toBeVisible();
  await expect(dorm.locator('[data-operator-identity="锡兰"]')).toBeVisible();
});

test("replay padlocks are read-only and one click in the editor releases both the bed and its operator", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/manual");
  const panel = page.locator("[data-mood-simulation]");
  const play = panel.getByRole("button", { name: "开始播放", exact: true });
  const board = page.locator("[data-manual-editor-board]:visible");
  const dorm = board.locator('[data-schedule-room="dorm_1"]');
  const trade = board.locator('[data-schedule-room="trade_1"]');
  const bedToggles = dorm.locator("[data-dorm-slot-toggle]");
  const savedLocks = () => page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-manual-schedule-v1")!).dormLocks);
  await expect(play).toBeEnabled({ timeout: 30_000 });
  await bedToggles.nth(0).click();
  await bedToggles.nth(2).click();
  await expect.poll(savedLocks).toHaveLength(2);
  await page.evaluate(() => {
    const key = "arknights-infra-manual-schedule-v1";
    const draft = JSON.parse(localStorage.getItem(key)!);
    // Older drafts wrote the lock's assignments directly into subsequent shifts.
    draft.activeShift = 1;
    draft.shifts[1].rooms = draft.shifts[0].rooms;
    localStorage.setItem(key, JSON.stringify(draft));
  });
  await page.reload();
  await expect(play).toBeEnabled();
  await expect(bedToggles.nth(0)).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("tab", { name: "心情回放", exact: true }).click();
  await expect(board).toHaveAttribute("data-board-mode", "simulation");
  await expect(dorm.locator("[data-dorm-slot-locked]")).toHaveCount(2);
  await expect(bedToggles).toHaveCount(0);

  await panel.getByRole("tab", { name: "排班编辑", exact: true }).click();
  await expect(board).toHaveAttribute("data-board-mode", "edit");
  await bedToggles.nth(0).click();
  await expect(bedToggles.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(bedToggles.nth(2)).toHaveAttribute("aria-pressed", "true");

  await expect.poll(savedLocks).toEqual([{ roomId: "dorm_1", slotIndex: 2, fromShift: 0, operator: null }]);
  await trade.getByRole("button", { name: /阿米娅/ }).click();
  const picker = page.getByRole("dialog");
  const allRooms = picker.getByRole("tablist", { name: "工作房间" }).getByRole("tab", { name: "全部", exact: true });
  await allRooms.click();
  await picker.getByLabel("搜索可选干员或基建技能").fill("菲亚梅塔");
  await picker.getByRole("button", { name: /菲亚梅塔/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "移动干员", exact: true }).click();
  await expect(trade.locator('[data-operator-identity="菲亚梅塔"]')).toBeVisible();
  await expect(dorm.locator('[data-operator-identity="菲亚梅塔"]')).toHaveCount(0);
  const firstBed = dorm.locator(".infra-operator-slot").first();
  await firstBed.getByRole("button", { name: /空位|自动补位/ }).click();
  await allRooms.click();
  await picker.getByRole("button", { name: /锡兰/ }).click();
  await expect(firstBed.locator('[data-operator-identity="锡兰"]')).toBeVisible();
  await page.reload();
  await expect(trade.locator('[data-operator-identity="菲亚梅塔"]')).toBeVisible();
  await expect(firstBed.locator('[data-operator-identity="锡兰"]')).toBeVisible();
  await expect(bedToggles.nth(0)).toHaveAttribute("aria-pressed", "false");
});

test("morale replay fills dorms in ascending admission morale across a room boundary", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/manual");
  const panel = page.locator("[data-mood-simulation]");
  const play = panel.getByRole("button", { name: "开始播放", exact: true });
  await expect(play).toBeEnabled({ timeout: 60_000 });
  await page.evaluate((sessionKey) => {
    const session = JSON.parse(localStorage.getItem(sessionKey)!);
    session.operbox.push(
      { id: "char_123_fang", name: "芬", elite: 1, level: 55, own: true, potential: 1, rarity: 3 },
      { id: "char_4246_dminon", name: "国度", elite: 2, level: 60, own: true, potential: 1, rarity: 6 },
    );
    localStorage.setItem(sessionKey, JSON.stringify(session));
    const draftKey = "arknights-infra-manual-schedule-v1";
    const draft = JSON.parse(localStorage.getItem(draftKey)!);
    const shift = { durationHours: 12, fiammettaTarget: null, droneTargetRoomId: null };
    Object.assign(draft, {
      activeShift: 1,
      fiammettaEnabled: false,
      dormLocks: [0, 1, 2, 3].map(slotIndex => ({ roomId: "dorm_1", slotIndex, fromShift: 1, operator: null })),
      shifts: [
        { ...shift, rooms: { power_1: { operators: ["芬"] }, recycling_station: { operators: ["国度"] } } },
        { ...shift, rooms: {} },
      ],
    });
    localStorage.setItem(draftKey, JSON.stringify(draft));
  }, sessionStorageKey);
  await page.reload();
  await expect(play).toBeEnabled({ timeout: 60_000 });
  await panel.getByRole("tab", { name: "心情回放", exact: true }).click();
  const timeline = panel.getByLabel("模拟时间轴");
  await expect(timeline).toHaveValue("12");
  const board = page.locator("[data-manual-editor-board]:visible");
  const first = board.locator('[data-schedule-room="dorm_1"]');
  const second = board.locator('[data-schedule-room="dorm_2"]');
  const lockedBeds = first.locator("[data-dorm-slot-locked]");
  const fang = first.locator('[data-operator-identity="芬"]');
  const dominion = second.locator('[data-operator-identity="国度"]');
  await expect(lockedBeds).toHaveCount(4);
  await expect(fang.getByLabel("当前心情 12/24")).toBeVisible();
  await expect(dominion.getByLabel("当前心情 13.2/24")).toBeVisible();
  expect((await fang.boundingBox())!.x).toBeGreaterThan((await lockedBeds.last().boundingBox())!.x);
  expect((await dominion.boundingBox())!.y).toBeGreaterThan((await fang.boundingBox())!.y);
});

test("recycling assignments from a legacy layout play back across a 36-hour rotation", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/manual");
  const panel = page.locator("[data-mood-simulation]");
  const play = panel.getByRole("button", { name: "开始播放", exact: true });
  await expect(play).toBeEnabled({ timeout: 60_000 });

  await page.evaluate((sessionKey) => {
    const session = JSON.parse(localStorage.getItem(sessionKey)!);
    session.layout.rooms = session.layout.rooms.filter((room: { kind: string }) => room.kind !== "recycle");
    session.layoutDirty = true;
    session.operbox.push({ id: "char_4246_dminon", name: "国度", elite: 2, level: 60, own: true, potential: 1, rarity: 6 });
    localStorage.setItem(sessionKey, JSON.stringify(session));
    const shift = { durationHours: 12, fiammettaTarget: null, droneTargetRoomId: null };
    localStorage.setItem("arknights-infra-manual-schedule-v1", JSON.stringify({
      version: 3, scheduleMode: "sequential", externalOperatorNames: [], startTime: "08:00", activeShift: 0, fiammettaEnabled: false,
      shifts: [
        { ...shift, rooms: { recycling_station: { operators: ["国度", "阿米娅"] } } },
        { ...shift, rooms: { recycling_station: { operators: ["国度", "阿米娅"] } } },
        { ...shift, rooms: { dorm_1: { operators: ["国度", "阿米娅"] } } },
      ],
    }));
  }, sessionStorageKey);
  await page.reload();
  await expect(play).toBeEnabled({ timeout: 60_000 });
  const board = page.locator("[data-manual-editor-board]:visible");
  const recycle = board.locator('[data-room-group="recycle"]');
  const timeline = panel.getByLabel("模拟时间轴");
  const detail = panel.locator("[data-mood-detail]");
  await expect(recycle.locator('[data-operator-identity="国度"]')).toBeVisible();

  await panel.getByRole("combobox", { name: "周期数", exact: true }).click();
  await page.getByRole("option", { name: "3", exact: true }).click();
  await expect(timeline).toHaveAttribute("max", "108");
  await expect(timeline).toBeEnabled();
  await panel.getByRole("tab", { name: "心情回放", exact: true }).click();
  await expect(recycle.locator('[data-operator-identity="阿米娅"]')).toBeVisible();
  await recycle.getByRole("button", { name: /国度/ }).filter({ has: page.locator('[data-operator-identity="国度"]') }).click();
  for (let step = 0; step < 4; step++) await timeline.press("ArrowRight");
  await expect(timeline).toHaveValue("1");
  await expect(recycle.locator('[data-operator-identity="国度"]').getByLabel("当前心情 23.1/24")).toBeVisible();
  await expect(detail.getByRole("heading")).toContainText("23.1 / 24");
  await expect(detail.getByText("回收站", { exact: true })).toBeVisible();
  await expect(detail.getByText(/净消耗 0\.9\/h/)).toBeVisible();

  await timeline.press("End");
  await expect(timeline).toHaveValue("108");
  await expect(board).toContainText("第 3 周期 · 第 3 班");
  await expect(panel.locator("[data-mood-time]")).toContainText("+4d 20:00 / +4d 20:00");
  await expect(detail.getByRole("heading")).toContainText("24 / 24");
  await expect(recycle.locator('[data-operator-identity="国度"]')).toHaveCount(0);
  await timeline.press("ArrowLeft");
  await expect(timeline).toHaveValue("107.75");
});

test("manual morale worker, timeline, shared targets and simulation-only settings",async ({page}) => {
  test.setTimeout(120_000);
  const errors: string[]=[];
  page.on("pageerror",e => errors.push(e.message));
  await page.goto("/manual");
  const panel=page.locator("[data-mood-simulation]");
  const choose=async (label:string,option:string) => {
    await page.getByRole("combobox",{name:label,exact:true}).click();
    await page.getByRole("option",{name:option,exact:true}).click();
  };
  const openSettings=async (name="模拟设置") => {
    const trigger=page.getByRole("button",{name,exact:true});
    if (!await trigger.isVisible()) await page.locator('[data-manual-more-tools] summary').click();
    await trigger.click();
  };
  await expect(panel).toBeVisible({timeout:60_000});
  await expect(panel.getByRole("button",{name:"开始播放",exact:true})).toBeEnabled({timeout:60_000});
  await expect(panel.getByRole("alert")).toHaveCount(0);
  // Playback keeps inactive shift boards mounted to avoid rebuilding them while seeking.
  const board=page.locator("[data-manual-editor-board]:visible");
  await expect(board).toHaveCount(1);
  await expect(page.locator("[data-schedule-toolbar]:visible")).toHaveCount(1);
  await expect(board).toHaveAttribute("data-board-mode","edit");
  await expect(panel.getByRole("heading",{name:"排班与心情模拟"})).toHaveCount(0);
  await expect(panel.getByText("从全员满心情开始，查看这套排班在连续周期内的变化。",{exact:true})).toHaveCount(0);
  await expect(panel.getByText("点击岗位调整干员。开始播放或拖动时间轴，可在当前看板查看心情变化。",{exact:true})).toHaveCount(0);
  await expect(panel.getByText("点击干员查看心情曲线；需要调整岗位时，切回排班编辑。",{exact:true})).toHaveCount(0);
  const setupBounds=await page.getByRole("button",{name:"配置 Box 与布局",exact:true}).boundingBox();
  const settingsBounds=await page.getByRole("button",{name:"模拟设置",exact:true}).boundingBox();
  expect(settingsBounds!.x).toBeGreaterThan(setupBounds!.x);
  expect(Math.abs(settingsBounds!.y-setupBounds!.y)).toBeLessThan(2);
  expect(await page.locator('[data-manual-draft-info]').evaluate(el => {
    const [draft,source]=Array.from(el.children).map(child => child.getBoundingClientRect());
    return Math.abs(draft!.y-source!.y)<6;
  })).toBe(true);
  expect(await board.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('[data-mood-playback-controls]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const before=await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-manual-schedule-v1")!));
  await choose("周期数","3");
  await expect(panel.getByRole("button",{name:"开始播放",exact:true})).toBeEnabled();
  await expect(panel.getByLabel("模拟时间轴")).toHaveAttribute("max","72");
  await choose("播放速度","3600×");
  await panel.getByRole("button",{name:"开始播放",exact:true}).click();
  await expect(board).toHaveCount(1);
  await expect(board).toHaveAttribute("data-board-mode","simulation");
  await expect(board.getByRole("button",{name:"清空当前班次所有设施"})).toHaveCount(0);
  await expect.poll(async () => Number(await panel.getByLabel("模拟时间轴").inputValue())).toBeGreaterThan(.1);
  await panel.getByRole("button",{name:"暂停",exact:true}).click();
  await panel.getByLabel("模拟时间轴").press("End");
  await expect(board).toContainText("第 3 周期 · 第 2 班");
  await expect(page.locator("[data-schedule-toolbar]:visible")).toHaveCount(1);
  await panel.getByRole("button",{name:"回到起点",exact:true}).click();
  await expect(panel.getByLabel("模拟时间轴")).toHaveValue("0");
  await panel.getByRole("button",{name:/锡兰/}).filter({has:page.locator('[data-operator-identity="锡兰"]')}).click();
  await expect(panel.locator("[data-mood-detail]")).toContainText("锡兰");
  await panel.getByRole("group",{name:"选择干员查看心情"}).getByRole("button",{name:/阿米娅/}).click();
  await expect(panel.locator("[data-mood-detail]")).toContainText("阿米娅");
  await panel.getByRole("tab",{name:"排班编辑",exact:true}).click();
  await expect(board).toHaveAttribute("data-board-mode","edit");
  await expect(page.locator("[data-schedule-toolbar]:visible")).toHaveCount(1);
  await board.getByRole("button",{name:/锡兰/}).filter({has:page.locator('[data-operator-identity="锡兰"]')}).click();
  await expect(page.getByRole("dialog").getByLabel("搜索可选干员或基建技能")).toBeVisible();
  await page.keyboard.press("Escape");
  await panel.getByRole("tab",{name:"心情回放",exact:true}).click();
  await expect(panel.locator("[data-mood-detail]")).toContainText("阿米娅");
  await openSettings();
  const dialog=page.getByRole("dialog",{name:"模拟设置"});
  await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(800);
  await expect(dialog.locator('[data-slot="scroll-area"]')).toHaveCount(1);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("switch",{name:"启用菲亚梅塔（同步手动排班）",exact:true})).toBeChecked();
  const idleGroup=dialog.locator('[data-slot="accordion-item"]').first();
  await idleGroup.locator('[data-slot="accordion-trigger"]').click();
  await idleGroup.getByRole("button",{name:"全不选",exact:true}).click();
  await expect.poll(async () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("riic.manual-mood.v1")!).settings.idle).some(row => !(row as {enabled:boolean}).enabled))).toBe(true);
  await expect(idleGroup.locator('[data-slot="accordion-trigger"]')).toHaveAttribute("aria-expanded","true");
  await idleGroup.getByRole("button",{name:"全选",exact:true}).click();
  await expect(dialog.getByText(/心情达到 24 即可互换/)).toBeVisible();
  await choose("第 1 班指定目标","锡兰");
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-manual-schedule-v1")!).shifts[0].fiammettaTarget)).toBe("锡兰");
  await choose("第 1 班目标模式","全基建最低心情");
  await dialog.getByRole("switch",{name:"启用闲置入宿（仅用于模拟）",exact:true}).uncheck();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button",{name:"开始播放",exact:true})).toBeEnabled();
  const after=await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-manual-schedule-v1")!));
  expect(after.shifts.map((s:{rooms:unknown}) => s.rooms)).toEqual(before.shifts.map((s:{rooms:unknown}) => s.rooms));
  await page.reload();
  await expect(panel.getByRole("button",{name:"开始播放",exact:true})).toBeEnabled({timeout:30_000});
  await expect(panel.getByLabel("周期数",{exact:true})).toHaveValue("3");
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('[data-manual-more-tools] summary')).toBeVisible();
  expect(await panel.evaluate(e => e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(2);
  await switchWorkbenchLanguage(page, "en");
  await expect(panel.getByRole("button",{name:"Play",exact:true})).toBeVisible();
  await openSettings("Simulation settings");
  await expect(page.getByRole("dialog",{name:"Simulation settings"})).toContainText("when her morale reaches 24");
  expect((await page.getByRole("dialog",{name:"Simulation settings"}).boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

for (const width of [1440,390]) {
  test(`manual morale playback preserves layout and expanded details at ${width}px`,async ({page}) => {
    test.setTimeout(120_000);
    await page.setViewportSize({width,height:900});
    await page.goto("/manual");
    const panel=page.locator("[data-mood-simulation]");
    await expect(panel.getByRole("button",{name:"开始播放",exact:true})).toBeEnabled({timeout:60_000});
    await panel.getByRole("combobox",{name:"周期数",exact:true}).click();
    await page.getByRole("option",{name:"7",exact:true}).click();
    await expect(panel.getByRole("button",{name:"开始播放",exact:true})).toBeEnabled();
    await panel.getByRole("tab",{name:"心情回放",exact:true}).click();
    const detail=panel.locator("[data-mood-detail]");
    const ledger=detail.locator("details").filter({hasText:"查看消耗与恢复明细"});
    await expect(ledger).toBeVisible();
    const rate=detail.getByText(/^消耗 .+\/h · 回复 .+\/h · 净消耗 .+\/h$/);
    await expect(rate).toBeVisible();
    const initialRate=await rate.innerText();
    const disclosures=await detail.locator("details").all();
    const timeline=panel.getByLabel("模拟时间轴");
    const timeReadout=panel.locator("[data-mood-time]");

    for (const speed of [1,3600]) {
      await panel.getByRole("combobox",{name:"播放速度",exact:true}).click();
      await page.getByRole("option",{name:`${speed}×`,exact:true}).click();
      for (const expanded of [false,true]) {
        if (expanded) for (const disclosure of disclosures) await disclosure.locator("summary").click();
        const originalLedger=await ledger.elementHandle();
        const detailElement=await detail.elementHandle();
        const height=(await detail.boundingBox())!.height;
        const startTime=Number(await timeReadout.getAttribute("data-mood-time"));
        await panel.getByRole("button",{name:"开始播放",exact:true}).click();
        const observed=await page.evaluate(async ({detail,ledger}) => {
          if (!detail || !ledger) throw new Error("Mood details are missing");
          const heights:number[]=[],chartPositions:number[]=[],openStates:boolean[]=[];
          let detached=false;
          const sample=() => {
            heights.push(detail.getBoundingClientRect().height);
            chartPositions.push(detail.querySelector('[data-slot="chart"]')!.getBoundingClientRect().top);
            detached ||= !ledger.isConnected;
            openStates.push((ledger as HTMLDetailsElement).open);
          };
          // Observe both painted frames and DOM removal between worker replies.
          const observer=new MutationObserver(sample);
          observer.observe(detail,{childList:true,subtree:true});
          const start=performance.now();
          await new Promise<void>(resolve => {
            const frame=() => {
              sample();
              if (performance.now()-start<2000) requestAnimationFrame(frame);
              else resolve();
            };
            frame();
          });
          observer.disconnect();
          return {
            samples:heights.length,detached,openStates:[...new Set(openStates)],
            minHeight:Math.min(...heights),maxHeight:Math.max(...heights),
            chartTravel:Math.max(...chartPositions)-Math.min(...chartPositions),
          };
        },{detail:detailElement,ledger:originalLedger});
        await panel.getByRole("button",{name:"暂停",exact:true}).click();
        expect(Number(await timeReadout.getAttribute("data-mood-time"))).toBeGreaterThan(startTime);
        await expect(rate).toBeVisible();
        await test.info().attach(`playback-${width}-${speed}-${expanded}`,{body:JSON.stringify(observed),contentType:"application/json"});
        expect(observed.samples).toBeGreaterThan(10);
        expect(observed.detached).toBe(false);
        expect(observed.openStates).toEqual([expanded]);
        expect(observed.minHeight).toBeCloseTo(height,0);
        expect(observed.maxHeight).toBeCloseTo(height,0);
        expect(observed.chartTravel).toBeLessThanOrEqual(1);
        for (const disclosure of disclosures) {
          await expect(disclosure).toHaveJSProperty("open",expanded);
          if (expanded) await disclosure.locator("summary").click();
        }
        await originalLedger?.dispose();
        await detailElement?.dispose();
      }
    }
    // A seek must refresh the actual rate without discarding the open disclosure.
    await ledger.locator("summary").click();
    await timeline.press("End");
    await expect(detail).toContainText("阿米娅");
    await expect(rate).toBeVisible();
    await expect(rate).not.toHaveText(initialRate);
    await expect(ledger).toHaveJSProperty("open",true);
    await expect(ledger.locator("tbody tr")).not.toHaveCount(0);
    await panel.getByRole("group",{name:"选择干员查看心情"}).getByRole("button",{name:/锡兰/}).click();
    await expect(detail.getByRole("heading")).toContainText("锡兰");
    await expect(ledger).toBeVisible();
  });
}
