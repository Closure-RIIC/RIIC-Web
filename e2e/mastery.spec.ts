import { test, expect } from "@playwright/test";
import roster from "../fixtures/operbox_full_e2.json" with { type: "json" };
import { gotoStable, mockApis, seedV4Session } from "./production-readiness.fixture";

const names = ["埃癸斯","艾丽妮","W","星熊","斩业星熊","望","桑葚","纯烬艾雅法拉","银灰","阿米娅","乌尔比安","余"];
const testBox = roster.filter((o) => names.includes(o.name)).map((o) => ({...o, id:o.name === "W" ? o.id.replace(/^char_/,"") : o.id, own:o.name !== "银灰", elite:o.name === "阿米娅" ? 1 : o.elite}));

test.beforeEach(async ({page}) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({status:200,contentType:"application/json",body:"null"}));
});

for (const mobile of [false,true]) {
  test.describe(mobile ? "mastery mobile" : "mastery desktop", () => {
    test.use({viewport:mobile ? {width:390,height:844} : {width:1440,height:1000}});
    test("owned E2 picker filters and complete mastery calculation", async ({page},testInfo) => {
      test.setTimeout(120000);
      await page.emulateMedia({reducedMotion:mobile ? "reduce" : "no-preference"});
      await mockApis(page);
      await seedV4Session(page,null,{operbox:testBox,boxSource:"sample"});
      await gotoStable(page,"/mastery");
      const unexpectedWrites: string[] = [];
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (request.method() !== "GET" && /^\/api\/(?:plan|tasks|workspace)(?:\/|$)/.test(path)) unexpectedWrites.push(path);
      });
      const beforeBox = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => /session-v[45]$/.test(key)).map(([,value]) => JSON.parse(value)).find((value) => value.operbox?.some((o: {name:string}) => o.name === "阿米娅"))?.operbox);
      await expect(page.getByRole("heading",{name:"专精规划",exact:true})).toBeVisible();
      const setupIcon = page.locator("[data-mastery-planner] [data-setup-action] svg");
      await expect(setupIcon).toHaveCount(1);
      if (mobile) await expect(setupIcon).toBeVisible();
      else await expect(setupIcon).toBeHidden();
      await page.getByRole("button",{name:"选择干员",exact:true}).click();
      const dialog = page.getByRole("dialog",{name:"选择专精干员"});
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("[data-setup-action] svg")).toHaveCount(0);
      await expect(dialog.getByRole("button",{name:"选择银灰",exact:true})).toHaveCount(0);
      await expect(dialog.getByRole("button",{name:"选择阿米娅",exact:true})).toHaveCount(0);
      await expect(dialog.getByRole("button",{name:"全选最高精英",exact:true})).toHaveCount(0);
      await dialog.getByRole("tablist",{name:"星级筛选"}).getByRole("tab",{name:"5 星干员",exact:true}).click();
      await expect(dialog.getByRole("button",{name:"选择桑葚",exact:true})).toBeVisible();
      await expect(dialog.getByRole("button",{name:"选择W",exact:true})).toHaveCount(0);
      await dialog.getByRole("tablist",{name:"职业筛选"}).getByRole("tab",{name:"近卫",exact:true}).click();
      await expect(dialog.getByText("没有符合条件的已拥有精二干员。",{exact:true})).toBeVisible();
      await dialog.getByRole("tablist",{name:"星级筛选"}).getByRole("tab",{name:"全部",exact:true}).click();
      await dialog.getByRole("tablist",{name:"职业筛选"}).getByRole("tab",{name:"狙击",exact:true}).click();
      await dialog.getByRole("textbox",{name:"搜索干员"}).fill("埃癸斯");
      await dialog.getByRole("button",{name:"选择埃癸斯",exact:true}).click();
      await expect(dialog.getByRole("button",{name:"选择埃癸斯",exact:true})).toHaveAttribute("aria-pressed","true");
      await page.screenshot({path:testInfo.outputPath("mastery-picker.png")});
      await dialog.getByRole("button",{name:"选择这名干员",exact:true}).click();
      await expect(page.getByRole("button",{name:"生成方案",exact:true})).toHaveCount(0);
      const result = page.locator("[data-mastery-results]");
      await expect(result).toContainText("17:16:57");
      const expectResultsAtTop = async () => {
        await expect.poll(async () => {
          const resultBox = await result.boundingBox();
          const viewport = await page.locator("[data-app-scroll-area]").boundingBox();
          return Math.round((resultBox?.y ?? -1) - (viewport?.y ?? 0));
        }).toBe(mobile ? 80 : 24);
        await expect(result.getByRole("tab",{name:"省操作",exact:true})).toBeInViewport();
      };
      await expectResultsAtTop();
      await expect(result.locator("[data-setup-action] svg")).toHaveCount(0);
      await expect(result).toContainText("保留艾丽妮，先开启专3，确认减半效果生效。");
      await expect(result).toContainText("减半生效后，立即换为W。");
      await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { sessionStorage.setItem("mastery-test-clipboard", text); } } }));
      await result.getByRole("button",{name:"复制操作清单",exact:true}).click();
      await expect(result.getByRole("button",{name:"已复制",exact:true})).toBeVisible();
      await expect(result.locator("[data-setup-action] svg")).toHaveCount(0);
      const clipboard = await page.evaluate(() => sessionStorage.getItem("mastery-test-clipboard"));
      expect(clipboard).toContain("埃癸斯 · 省操作 · 17:16:57");
      expect(clipboard).toContain("先开启专3");
      expect(clipboard).toContain("中枢加成 +5% · 操作余量 1 分钟");
      expect(clipboard).toContain("训练室等级满足要求");
      await result.getByRole("tab",{name:"极速",exact:true}).click();
      await expect(result).toContainText("比省操作节省");
      await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Clipboard permission denied"); } } }));
      await result.getByRole("button",{name:"复制操作清单",exact:true}).click();
      await expect(page.getByRole("alert").filter({hasText:"复制失败，请检查浏览器剪贴板权限。"})).toBeVisible();
      await page.screenshot({path:testInfo.outputPath("mastery-results.png"),fullPage:true});
      const geometry = await page.evaluate(() => ({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
      if (mobile) await page.locator("[data-mastery-planner] summary").click();
      const previousTime = await result.locator("strong").first().textContent();
      const controlBonus = page.getByRole("button",{name:"中枢专精加成 +5%",exact:true});
      await controlBonus.click();
      if (mobile) await expect(page.getByRole("button",{name:"中枢专精加成 +0%",exact:true})).toHaveAttribute("aria-pressed","false");
      await expect(result).toBeVisible();
      await expect(result.locator("strong").first()).not.toHaveText(previousTime!);
      await expect(page.locator("[data-mastery-planner]").getByRole("alert")).toHaveCount(0);
      await expect(page.getByText("输入或 Box 已变化，请重新生成方案。",{exact:true})).toHaveCount(0);
      await expect(page.getByRole("button",{name:mobile ? "中枢专精加成 +0%" : "中枢专精加成 +5%",exact:true})).toBeInViewport();
      await page.getByRole("tablist",{name:"当前专精等级",exact:true}).getByRole("tab",{name:"专2",exact:true}).click();
      await expect(page.getByRole("tablist",{name:"目标专精等级",exact:true}).getByRole("tab",{name:"专1",exact:true})).toBeDisabled();
      await expect(result.getByRole("heading",{name:/^专1/})).toHaveCount(0);
      await expect(result.getByRole("heading",{name:/^专3/})).toHaveCount(1);
      if (!mobile) await page.locator("[data-mastery-planner] summary").click();
      const buffer = page.getByRole("spinbutton",{name:"换人操作余量（分钟）",exact:true});
      await buffer.fill("-1");
      await expect(page.locator("[data-mastery-planner]").getByRole("alert")).toContainText("操作余量必须是非负数");
      await expect(result).toHaveCount(0);
      await buffer.fill("1");
      await expect(result).toBeVisible();
      await expect(page.locator("[data-mastery-planner]").getByRole("alert")).toHaveCount(0);
      // The calculation never invokes the solver or writes the operator Box.
      const stored = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => /session-v[45]$/.test(key)).map(([,value]) => JSON.parse(value)));
      const saved = stored.find((value) => value.operbox?.some((o: {name:string}) => o.name === "阿米娅"));
      expect(saved.operbox.find((o: {name:string}) => o.name === "阿米娅").elite).toBe(1);
      expect(saved.operbox).toEqual(beforeBox);
      expect(unexpectedWrites).toEqual([]);
    });
  });
}

test("mastery guest login lock and empty Box state",async ({page}) => {
  await mockApis(page);
  await gotoStable(page,"/mastery");
  await expect(page.getByText("登录后使用自己的 Box",{exact:true})).toBeVisible();
  await expect(page.locator("[data-mastery-results]")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"生成方案",exact:true})).toHaveCount(0);
  const setupIcon = page.locator("[data-mastery-planner] [data-setup-action] svg");
  await expect(setupIcon).toHaveCount(1);
  if ((page.viewportSize()?.width ?? 1440) < 768) await expect(setupIcon).toBeVisible();
  else await expect(setupIcon).toBeHidden();
  await page.getByRole("button",{name:"选择干员",exact:true}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("[data-mastery-target-picker]")).toHaveCount(0);
});
