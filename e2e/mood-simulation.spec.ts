import { expect, test } from "@playwright/test";
import { switchWorkbenchLanguage } from "./workbench-language";
import layout from "@riic/arknights-domain/layouts/243.json" with {type:"json"};
import { mockApis, mockSignedInWebsiteSession } from "./production-readiness.fixture";

test.beforeEach(async ({page}) => {
  await mockApis(page);
  await mockSignedInWebsiteSession(page);
  await page.addInitScript(({layout}) => {
    if (localStorage.getItem("mood-e2e-seeded")) return;
    localStorage.setItem("mood-e2e-seeded","1");
    localStorage.setItem("arknights-infra-calc-beta-onboarding-v1","1");
    const operbox=[
      {id:"char_002_amiya",name:"阿米娅",elite:2,level:80,own:true,potential:1,rarity:5},
      {id:"char_300_phenxi",name:"菲亚梅塔",elite:2,level:60,own:true,potential:1,rarity:6},
      {id:"char_348_ceylon",name:"锡兰",elite:2,level:60,own:true,potential:1,rarity:5},
    ];
    localStorage.setItem("arknights-infra-calc-session-v5",JSON.stringify({
      version:5,savedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),
      presetLabel:"243",layout,operbox,sourceName:"Mood test",boxSource:"sample",layoutDirty:false,layoutSource:"local",localLayoutBackup:null,
      rotationProfile:"abc_12_6_6",fiammettaEnabled:true,result:null,activeShift:0,
    }));
    localStorage.setItem("arknights-infra-manual-schedule-v1",JSON.stringify({
      version:3,scheduleMode:"sequential",externalOperatorNames:[],startTime:"08:00",activeShift:0,fiammettaEnabled:true,
      shifts:[{durationHours:12,fiammettaTarget:"阿米娅",droneTargetRoomId:null,rooms:{trade_1:{operators:["阿米娅"]},dorm_1:{operators:["菲亚梅塔","锡兰"]}}},
        {durationHours:12,fiammettaTarget:"锡兰",droneTargetRoomId:null,rooms:{trade_1:{operators:["锡兰"]},dorm_1:{operators:["菲亚梅塔"]}}}],
    }));
  },{layout});
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
  await dialog.getByRole("switch",{name:"等她回满再换（强制切换）",exact:true}).first().check();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("riic.manual-mood.v1")!).settings.fiammetta[0].wait)).toBe(true);
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
  await expect(page.getByRole("dialog",{name:"Simulation settings"})).toContainText("simulation-only");
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

    for (const speed of [1,3600]) {
      await panel.getByRole("combobox",{name:"播放速度",exact:true}).click();
      await page.getByRole("option",{name:`${speed}×`,exact:true}).click();
      for (const expanded of [false,true]) {
        if (expanded) for (const disclosure of disclosures) await disclosure.locator("summary").click();
        const originalLedger=await ledger.elementHandle();
        const detailElement=await detail.elementHandle();
        const height=(await detail.boundingBox())!.height;
        const startTime=Number(await timeline.getAttribute("value"));
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
        expect(Number(await timeline.getAttribute("value"))).toBeGreaterThan(startTime);
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
