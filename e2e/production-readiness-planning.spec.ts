import { expect, test } from "@playwright/test";
import { requestId, diagnosticId, expectUnifiedDialogTypography, expectUnifiedDialogAction, expectButtonGeometryStable, armEndingTransitionCapture, expectCapturedExitDuration, armMotionCapture, armMotionCollectionCapture, expectCapturedMotion, expectCapturedMotionDelays, armTransientStyleCapture, expectCapturedStyleMotion, waitForOwnAnimations, planData, twoShiftPlanData, scheduleVisualPlanData, productChangePlanData, motionPlanData, authenticatedSklandSnapshot, mockApis, navigateToPrimaryPage, seedPreferences, seedV4Session } from "./production-readiness.fixture";
import type { PublicPlanData } from "../src/types";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "test-session", token: "test-token", userId: "test-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      user: { id: "test-user", name: "测试用户", email: "test@example.com", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }),
  }));
});

test("solver iteration notice appears after completion and can be dismissed to use results", async ({ page }) => {
  await mockApis(page, { dismissSolverWarning: false });
  await seedV4Session(page, null);
  await page.goto("/");
  const notice = page.getByRole("dialog", { name: "排班已生成", exact: true });
  await expect(notice).toHaveCount(0);
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("对应房间右上角的反馈按钮");
  await notice.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator("[data-plan-summary]")).toBeVisible();
  await page.getByRole("button", { name: "练卡建议", exact: true }).click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(notice).toHaveCount(0);
});

test("the legacy beta query is inert and never opts plan requests into debug data", async ({ page }) => {
  await mockApis(page, { debugTools: true });
  await seedV4Session(page);
  const planRequests: URL[] = [];
  await page.route(/\/api\/plan(?:\?.*)?$/, (route) => {
    const requestUrl = new URL(route.request().url());
    planRequests.push(requestUrl);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { ...planData, debug: { command: "infra-cli serve", stdout: "test output", stderr: "" } },
        requestId,
      }),
    });
  });

  await page.goto("/?beta");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await expect(page.getByText("开启调试工具", { exact: true })).toHaveCount(0);
  await expect(page.getByText("退出调试工具", { exact: true })).toHaveCount(0);
  await expect(page.getByText("调试输出", { exact: true })).toHaveCount(0);
  await expect(page.getByText("问题上下文", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "生成排班" }).click();
  await expect.poll(() => planRequests.length).toBe(1);
  expect(planRequests[0].searchParams.has("beta")).toBe(false);

  await page.getByRole("button", { name: "练卡建议" }).click();
  await expect(page).toHaveURL(/\/training$/, { timeout: 45_000 });
});

test("shows the status mark through a plan request lifecycle", async ({ page }) => {
  await mockApis(page);
  let releasePlan!: () => void;
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  await page.route("**/api/plan", async (route) => {
    await planGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: planData, requestId }),
    });
  });
  await seedV4Session(page, null);
  await page.goto("/");

  await page.getByRole("button", { name: "生成排班" }).click();

  const status = page.locator('[data-slot="live-activity"]');
  const expandedMark = status.locator('[data-slot="status-mark-rail"] [data-live-activity-icon]');
  const markRail = status.locator('[data-slot="status-mark-rail"]');
  const body = status.locator('[data-slot="live-activity-body"]');
  const progress = status.locator('[data-slot="activity-progress-indicator"]');
  await expect(status).toContainText("正在生成排班");
  await expect(status).toHaveClass(/bg-card/);
  await expect(expandedMark).toBeVisible();
  await expect(expandedMark).toHaveAttribute("data-status", "running");
  const runningRing = expandedMark.locator(".status-mark__ring");
  const startingOffset = await runningRing.getAttribute("stroke-dashoffset");
  await expect.poll(() => runningRing.getAttribute("stroke-dashoffset")).not.toBe(startingOffset);
  await expect(status.locator("[data-live-activity-icon]")).toHaveCount(2);
  await expect(status.locator("svg")).toHaveCount(2);
  await expect(markRail).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const [bodyBox, railBox, runningLabelBox] = await Promise.all([
    body.boundingBox(),
    markRail.boundingBox(),
    status.locator("strong").first().boundingBox(),
  ]);
  expect(railBox?.height).toBeCloseTo(bodyBox?.height ?? 0, 0);
  expect((runningLabelBox?.x ?? 0) - ((railBox?.x ?? 0) + (railBox?.width ?? 0))).toBeGreaterThanOrEqual(3);
  await expect(status.locator(".live-activity-shimmer")).toHaveCount(0);
  await expect(progress).toBeVisible();
  await expect(progress).toHaveCSS("width", /.+/);
  await expect(status).toHaveCSS("border-radius", "11px");
  await expect(status).toHaveAttribute("data-activity-view", "compact");
  await expect.poll(() => status.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(40);
  await status.hover();
  await expect(status).toHaveAttribute("data-activity-view", "expanded");
  await expect.poll(() => status.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(70);
  await page.mouse.move(0, 300);
  await expect(status).toHaveAttribute("data-activity-view", "compact");
  await status.focus();
  await expect(status).toHaveAttribute("data-activity-view", "expanded");
  await page.keyboard.press("Escape");
  await expect(status).toHaveAttribute("data-activity-view", "compact");

  releasePlan();
  await expect(status).toHaveAttribute("data-activity-phase", "success");
  await expect(status).toHaveClass(/bg-card/);
  await expect(status.locator('[data-slot="status-mark-rail"] [data-live-activity-icon]')).toHaveAttribute("data-status", "done");
  await expect(status.locator("[data-live-activity-icon]")).toHaveCount(2);
  await expect(status.locator("svg")).toHaveCount(2);
  await expect(status.locator('[data-slot="activity-success-sweep"]')).toHaveCount(0);
  await expect(status.locator('[data-slot="activity-progress-track"]')).toHaveCount(0);
});

test("buffered plans show a quiet candidate-ring state and can be dismissed without resubmitting", async ({ page }) => {
  await mockApis(page, { taskQueueEnabled: true });
  let taskSubmissions = 0;
  await page.route(/\/api\/tasks(?:\/[^/?]+)?$/, (route) => {
    if (route.request().method() === "POST") taskSubmissions += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          taskId: "11111111-1111-4111-8111-111111111112",
          status: "buffered",
          selectionPoolSize: 37,
        },
        requestId,
      }),
    });
  });
  await seedV4Session(page, null, { boxSource: "maa" });
  await page.goto("/");

  await page.getByRole("button", { name: "生成排班" }).click();
  const activity = page.locator('[data-slot="live-activity"]');
  await expect(activity).toHaveAttribute("data-activity-phase", "queued");
  await expect(activity).toContainText("当前进入候选环，名额释放后随机抽取。");
  await expect(activity.locator('[data-slot="status-mark-rail"] [data-live-activity-icon]')).toHaveAttribute("data-status", "pending");
  await expect(activity.locator("[data-live-activity-icon]")).toHaveCount(2);
  await expect.poll(() => taskSubmissions).toBe(1);

  await activity.getByRole("button", { name: "关闭提示" }).click();
  await expect(activity).toHaveCount(0);
  expect(taskSubmissions).toBe(1);
});

test("stopped task polling allows immediate manual retry and single-flight network recovery", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Keep the completion notice open: this test controls polling time, while
  // the dedicated notice test verifies dismissal with real animation time.
  await mockApis(page, { taskQueueEnabled: true, dismissSolverWarning: false });
  let submissions = 0;
  let polls = 0;
  let recovering = false;
  let releaseRecovery!: () => void;
  const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
  const taskId = "11111111-1111-4111-8111-111111111113";
  await page.route(/\/api\/tasks(?:\/[^/?]+)?$/, async (route) => {
    if (route.request().method() === "POST") {
      submissions++;
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, data: { taskId, status: "buffered", selectionPoolSize: 37 }, requestId }),
      });
      return;
    }
    polls++;
    if (!recovering) {
      await route.abort("failed");
      return;
    }
    await recoveryGate;
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ success: true, data: { taskId, status: "done", result: planData }, requestId }),
    });
  });
  await seedV4Session(page, null, { boxSource: "maa" });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.clock.install();
  await page.getByRole("button", { name: "生成排班" }).click();
  const resume = page.getByRole("button", { name: "查询进度", exact: true });
  const exhaustBackoff = async (expectedPolls: number) => {
    await expect.poll(async () => {
      if (polls < expectedPolls) await page.clock.fastForward(33_100);
      return polls;
    }, { timeout: 10_000 }).toBe(expectedPolls);
    // Do not advance the clock after the final failure: there must be no extra cooldown.
    await expect(resume).toBeEnabled();
  };
  await exhaustBackoff(6);
  await resume.click();
  await expect.poll(() => polls).toBe(7);
  expect(submissions).toBe(1);

  await exhaustBackoff(12);
  recovering = true;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => polls).toBe(13);
  await page.clock.fastForward(1_100);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  expect(polls).toBe(13);
  releaseRecovery();
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
  expect(submissions).toBe(1);
  expect(pageErrors.filter((message) => message.includes("Illegal invocation"))).toEqual([]);
});

test("operator skill terms reveal square hover cards on pointer and keyboard focus", async ({ page }) => {
  await mockApis(page);
  const termPlanData = structuredClone(scheduleVisualPlanData);
  termPlanData.maa.plans[0].rooms.trading[0].operators = [{ name: "陈", skill: 1 }];
  await seedV4Session(page, termPlanData, {
    boxSource: "maa",
    operbox: [{ id: "char_010_chen", name: "陈", elite: 0, level: 1, own: true, potential: 1, rarity: 6 }],
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const operatorPortrait = page.getByRole("img", { name: "陈" }).first();
  const portraitBox = await operatorPortrait.boundingBox();
  await operatorPortrait.hover({ position: { x: 8, y: Math.max(8, (portraitBox?.height ?? 80) / 2) } });
  const skillTooltip = page.locator('[data-slot="tooltip-content"][data-open]');
  await expect(skillTooltip).toBeVisible({ timeout: 10_000 });
  await expect(skillTooltip.locator('[data-skill-unlocked="false"]')).toHaveCSS("opacity", "0.7");
  await expect(skillTooltip.locator('[data-skill-unlocked="false"]')).toHaveCSS("filter", "grayscale(1)");
  const termTrigger = skillTooltip.locator(".riic-term-hover > .riic-term").first();
  const termCard = skillTooltip.locator(".riic-term-hover-card").first();

  await termTrigger.hover();
  await expect(termCard).toBeVisible();
  await expect(termCard).toContainText("龙门近卫局");
  await expect(termCard).toHaveCSS("border-radius", "0px");
  await termTrigger.focus();
  await expect(termCard).toBeVisible();
});

test("Lancet-2 power rooms without total efficiency omit the readout with a red portrait filter", async ({ page }) => {
  await mockApis(page);
  const lancetPlanData = structuredClone(scheduleVisualPlanData) as PublicPlanData;
  lancetPlanData.maa.plans[0]!.rooms.power = [
    { operators: ["Castle-3"] },
    { operators: ["Lancet-2"] },
  ];
  lancetPlanData.rotation.shifts[0]!.scores.room_lines = [
    ...lancetPlanData.rotation.shifts[0]!.scores.room_lines.filter((line) => line.room_id !== "power_1" && line.room_id !== "power_2"),
    { room_id: "power_1", order_multiplier: 1 },
    { room_id: "power_2", order_multiplier: 1 },
  ];
  await seedV4Session(page, lancetPlanData, { boxSource: "maa" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const ordinaryPowerRoom = page.locator('[data-room-title="发电站 1"]');
  const lancetPowerRoom = page.locator('[data-room-title="发电站 2"]');
  await expect(lancetPowerRoom.locator("[data-room-primary-efficiency]")).toHaveCount(0);
  await expect(lancetPowerRoom.locator('[data-operator-identity="Lancet-2"] [data-operator-portrait-alert="missing-power-efficiency"]')).toBeVisible();
  await expect(ordinaryPowerRoom.locator('[data-operator-portrait-alert="missing-power-efficiency"]')).toHaveCount(0);
});

test("Skland calculator keeps the schedule visible before and after sidebar navigation", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: {
      ...authenticatedSklandSnapshot,
      infrastructure: {
        ...authenticatedSklandSnapshot.infrastructure,
        layoutSuggestion: null,
      },
    },
  });
  await seedPreferences(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.locator("[data-skland-account-control]")).toBeVisible();
  const runButton = page.getByRole("button", { name: "生成排班" });
  await expect(runButton).toBeEnabled();

  await expect(page.locator("[data-plan-board]")).toBeVisible();
  await expect(page.locator("[data-calculator-regenerate-panel]")).toHaveCount(0);

  await runButton.click();
  await expect(page.locator('[data-slot="live-activity"]')).toHaveAttribute("data-activity-phase", "success");
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
  await expect(page.getByRole("button", { name: "导出到 MAA" })).toBeEnabled();
  const comparisonTrigger = page.locator('[data-plan-details-trigger="comparison"]');
  await expect(comparisonTrigger).toBeVisible();
  await comparisonTrigger.click();
  const comparisonSheet = page.locator('[data-slot="drawer-content"]');
  await expect(comparisonSheet.locator("[data-plan-details-section]")).toHaveAttribute("data-plan-details-section", "comparison");
  await expect(comparisonSheet.locator("[data-shift-comparison-details]")).toBeVisible();
  await expect(comparisonSheet.getByText("非宿舍匹配", { exact: true })).toBeVisible();
  await expect(comparisonSheet.getByRole("progressbar", { name: "非宿舍设施匹配百分比" })).toBeVisible();
  const desktopAdjustmentGroups = comparisonSheet.locator("[data-desktop-adjustment-groups]");
  await expect(desktopAdjustmentGroups).toBeVisible();
  await expect(desktopAdjustmentGroups.getByRole("heading", { level: 4 })).toContainText(["需换出", "需换入", "位置调整"]);
  const mobileIssueTone = { unexpected: "bg-amber-100", missing: "bg-sky-100", misplaced: "bg-zinc-200" } as const;
  for (const issue of ["unexpected", "missing", "misplaced"] as const) {
    const group = desktopAdjustmentGroups.locator(`[data-adjustment-group="${issue}"]`);
    const declaredCount = Number((await group.locator(".font-number").textContent())?.match(/\d+/)?.[0] ?? 0);
    const table = group.locator(`[data-desktop-adjustment-table="${issue}"]`);
    if (declaredCount === 0) {
      await expect(table).toHaveCount(0);
      await expect(group.getByText("无", { exact: true })).toBeVisible();
      continue;
    }
    await expect(table.locator("tbody tr")).toHaveCount(declaredCount);
    const tableColumnOffsets = await table.evaluate((element) => {
      const headers = Array.from(element.querySelectorAll("th"));
      const firstRowCells = Array.from(element.querySelectorAll("tbody tr:first-child td"));
      return headers.map((header, index) => Math.abs(header.getBoundingClientRect().x - firstRowCells[index].getBoundingClientRect().x));
    });
    expect(tableColumnOffsets.every((offset) => offset < 0.5)).toBe(true);
  }
  const desktopRoomLabels = desktopAdjustmentGroups.locator("[data-room-label]");
  await expect(desktopRoomLabels.first()).toBeVisible();
  await expect(desktopRoomLabels.first()).toHaveCSS("border-width", "0px");
  await expect(desktopRoomLabels.first().locator("[data-room-indicator]")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileAdjustmentGroups = comparisonSheet.locator("[data-mobile-adjustment-groups]");
  await expect(mobileAdjustmentGroups).toBeVisible();
  await expect(mobileAdjustmentGroups.getByRole("heading", { level: 4 })).toContainText(["需换出", "需换入", "位置调整"]);
  for (const issue of ["unexpected", "missing", "misplaced"] as const) {
    const group = mobileAdjustmentGroups.locator(`[data-adjustment-group="${issue}"]`);
    const declaredCount = Number((await group.locator(".font-number").textContent())?.match(/\d+/)?.[0] ?? 0);
    await expect(group.locator("li strong")).toHaveCount(declaredCount);
    await expect(group.getByRole("heading", { level: 4 }).locator("span")).toHaveClass(new RegExp(mobileIssueTone[issue]));
    if (declaredCount === 0) await expect(group.getByText("无", { exact: true })).toBeVisible();
  }
  await expect(mobileAdjustmentGroups.locator("[data-room-label]").first()).toBeVisible();
  await expect(mobileAdjustmentGroups.locator("[data-room-label]").first()).toHaveCSS("border-width", "0px");
  const firstMobileAdjustmentRow = mobileAdjustmentGroups.locator("[data-mobile-adjustment-row]").first();
  const mobileRowAlignment = await firstMobileAdjustmentRow.evaluate((row) => {
    const operator = row.querySelector("strong")?.getBoundingClientRect();
    const action = row.querySelector("[data-mobile-adjustment-action]")?.getBoundingClientRect();
    return operator && action ? Math.abs((operator.top + operator.height / 2) - (action.top + action.height / 2)) : Number.POSITIVE_INFINITY;
  });
  expect(mobileRowAlignment).toBeLessThan(2);
  await expect(firstMobileAdjustmentRow.locator("strong")).toHaveCSS("font-size", "14px");
  const mobileComparisonWidth = await mobileAdjustmentGroups.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(mobileComparisonWidth.scroll).toBeLessThanOrEqual(mobileComparisonWidth.client);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="drawer-root"]')).toHaveCount(0);
  await expect(comparisonTrigger).toBeFocused();

  const returnToCalculator = async (destination: "练卡建议" | "森空岛状态中心", marker: string, label: string) => {
    await page.getByRole("button", { name: destination, exact: true }).click();
    await expect(page.locator(marker)).toBeVisible();
    await armMotionCapture(page, "[data-plan-board]", label, 320);
    await armMotionCapture(page, "[data-plan-result-summary]", `${label}-summary`, 460);
    await armMotionCapture(page, "[data-plan-result-summary] [data-plan-metric]", `${label}-metrics`, 360);
    await page.getByRole("button", { name: "基建计算器", exact: true }).click();

    const returnedBoard = page.locator("[data-plan-board]");
    await expect(returnedBoard).toBeVisible();
    await expect(returnedBoard).toHaveCSS("opacity", "1");
    await expect(returnedBoard).toHaveAttribute("data-plan-revision", diagnosticId);
    await expect(page.getByRole("button", { name: "导出到 MAA" })).toBeEnabled();
    await page.waitForTimeout(650);
    expect(await page.locator("html").getAttribute(`data-motion-enter-${label}`)).toBeNull();
    expect(await page.locator("html").getAttribute(`data-motion-enter-${label}-summary`)).toBeNull();
    expect(await page.locator("html").getAttribute(`data-motion-enter-${label}-metrics`)).toBeNull();
  };

  await returnToCalculator("练卡建议", '[data-slot="training-summary"]', "calculator-return-training");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await returnToCalculator("森空岛状态中心", "[data-skland-view-tabs]", "calculator-return-skland-reduced");
});

test("desktop sidebar state survives navigation and a hard reload without hydration errors", async ({ page, context }) => {
  await mockApis(page);
  await seedPreferences(page);
  await context.addCookies([{ name: "sidebar_state", value: "true", domain: "127.0.0.1", path: "/" }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|server rendered html/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });

  await page.goto("/");
  const sidebar = page.locator('[data-slot="sidebar"]:not([data-mobile="true"])');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  await page.getByRole("button", { name: "练卡建议", exact: true }).click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  await page.reload();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  expect(hydrationErrors).toEqual([]);
});

test("desktop sidebar defaults open at 1280px and collapsed below it", async ({ page, context }) => {
  await mockApis(page);
  await seedPreferences(page);
  await context.clearCookies();
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|server rendered html/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });

  const sidebar = page.locator('[data-slot="sidebar"]:not([data-mobile="true"])');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  await page.setViewportSize({ width: 1279, height: 900 });
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");

  await context.addCookies([{ name: "sidebar_state", value: "true", domain: "127.0.0.1", path: "/" }]);
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  await context.addCookies([{ name: "sidebar_state", value: "false", domain: "127.0.0.1", path: "/" }]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  expect(hydrationErrors).toEqual([]);
});

test("100% Skland match does not count fatigue-only notices as adjustments", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: {
      ...authenticatedSklandSnapshot,
      infrastructure: {
        ...authenticatedSklandSnapshot.infrastructure,
        layoutSuggestion: null,
      },
    },
  });
  const exactPlacementPlanData = {
    ...planData,
    maa: {
      ...planData.maa,
      plans: planData.maa.plans.map((plan) => ({
        ...plan,
        rooms: {
          control: [{ operators: ["阿米娅"] }],
        },
      })),
    },
  };
  await page.route("**/api/plan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data: exactPlacementPlanData, requestId }),
  }));
  await seedPreferences(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.locator("[data-skland-account-control]")).toBeVisible();
  await expect(page.locator("[data-plan-board]")).toBeVisible();
  await expect(page.locator("[data-plan-board]")).not.toHaveAttribute("data-plan-revision", /.+/);
  const runButton = page.getByRole("button", { name: "生成排班" });
  await expect(runButton).toBeEnabled();
  await runButton.click();
  await expect(page.locator('[data-slot="live-activity"]')).toHaveAttribute("data-activity-phase", "success");

  const comparisonSummary = page.locator('[data-plan-details-trigger="comparison"]');
  await expect(comparisonSummary).toContainText(/匹配率\s*100%/);
  await expect(comparisonSummary).toContainText("无需调整");
  await expect(comparisonSummary).not.toContainText(/需调整\s*1\s*处/);
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(comparisonSummary).toBeVisible();
    await expect(comparisonSummary).toContainText("无需调整");
  }
});

test("empty returning calculator shows the empty compact schedule", async ({ page }) => {
  await mockApis(page);
  await seedPreferences(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.locator("[data-calculator-regenerate-panel]")).toHaveCount(0);
  await expect(page.locator('[data-schedule-view="compact"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-operator-identity="empty"]').first()).toBeVisible();
  await page.getByRole("button", { name: "练卡建议", exact: true }).click();
  await expect(page.locator("[data-training-page]")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("ADVICE QUEUE · 00", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "前往生成排班", exact: true })).toHaveCSS("border-radius", "22px");
  await page.getByRole("button", { name: "基建计算器", exact: true }).click();

  await expect(page.locator("[data-calculator-regenerate-panel]")).toHaveCount(0);
  await expect(page.locator('[data-schedule-view="compact"]')).toBeVisible();
  await expect(page.locator('[data-operator-identity="empty"]').first()).toBeVisible();
});

test("compact schedule reserves one skeleton card per room while its view loads", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  const listView = page.locator('[data-schedule-view="list"]');
  await expect(listView).toBeVisible();
  const roomCount = await listView.locator("[data-room-group]").count();

  let releaseCompactChunk!: () => void;
  const compactChunkGate = new Promise<void>((resolve) => {
    releaseCompactChunk = resolve;
  });
  let compactChunkRequested = false;
  await page.route("**/_next/static/chunks/**", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (body.toString("utf8").includes("data-compact-schedule-view")) {
      compactChunkRequested = true;
      await compactChunkGate;
    }
    await route.fulfill({ response, body });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => compactChunkRequested).toBe(true);
  const loadingView = page.locator('[data-schedule-view="compact"]');
  const skeleton = loadingView.locator("[data-compact-schedule-loading]");
  await expect(loadingView).toHaveAttribute("data-schedule-view-transition", "skeleton");
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator("[data-compact-room-skeleton]")).toHaveCount(roomCount);
  expect(await loadingView.evaluate((element) => element.getAnimations().length)).toBe(0);

  releaseCompactChunk();
  await expect(page.locator("[data-compact-schedule-view]")).toBeVisible();
  await expect(skeleton).toHaveCount(0);
});

test("mobile list follows the in-game assignment overview without rendering the compact view", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, motionPlanData);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const board = page.locator("[data-plan-board]");
  const mobileListView = board.locator('[data-schedule-view="list"]');
  await expect(mobileListView).toBeVisible();
  await expect(board.locator('[data-schedule-view="compact"]')).toHaveCount(0);
  await expect.poll(() => mobileListView.locator(":scope > section").evaluateAll((sections) => (
    sections.slice(0, 6).map((section) => section.getAttribute("data-list-room-group"))
  ))).toEqual(["control", "meeting", "manufacture", "trading", "power", "hire"]);
});

test("plan completion reveals status, metrics, and schedule once without resetting board state", async ({ page, browserName }) => {
  const invalidTransformWarnings: string[] = [];
  page.on("console", (message) => {
    if (/Invalid keyframe value for property transform|translate0d/i.test(message.text())) {
      invalidTransformWarnings.push(message.text());
    }
  });
  await mockApis(page);
  let releasePlan!: () => void;
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  await page.route("**/api/plan", async (route) => {
    await planGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: motionPlanData, requestId }),
    });
  });
  await seedV4Session(page, null);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const listTab = page.getByRole("tab", { name: "列表式布局" });
  const board = page.locator("[data-plan-board]");
  await expect(listTab).toBeVisible();
  await expect(board).toBeVisible();
  await expect(board).not.toHaveAttribute("data-plan-revision", /.+/);

  await armTransientStyleCapture(page, '[data-activity-phase="running"]', "loading-status");
  await page.getByRole("button", { name: "生成排班" }).click();
  const status = page.locator('[data-slot="live-activity"]');
  await expect(status).toHaveAttribute("data-activity-phase", "running");
  await expectCapturedStyleMotion(page, "loading-status");

  if (browserName === "webkit") {
    await armTransientStyleCapture(page, "[data-plan-summary]", "plan-summary");
    await armTransientStyleCapture(page, "[data-plan-metric]", "plan-metrics");
  } else {
    await armMotionCapture(page, "[data-plan-summary]", "plan-summary", 460);
    await armMotionCollectionCapture(page, "[data-plan-metric]", "plan-metrics", 360);
  }
  releasePlan();
  await expect(status).toHaveAttribute("data-activity-phase", "success");
  const summary = page.locator("[data-plan-summary]");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("data-plan-entrance", "animated");
  await expect(board).toHaveAttribute("data-plan-revision", diagnosticId);
  await listTab.click();
  const listTrainingRoom = board.locator('[data-schedule-view="list"] [data-room-group="training"]');
  await expect(listTrainingRoom).toBeVisible();
  await expect(listTrainingRoom.locator('[data-position="训练位"]')).toContainText("Training-A");
  await expect(listTrainingRoom.locator('[data-position="协助位"]')).toContainText("Trainer-A");
  await expect(listTrainingRoom).not.toContainText("不参与 MAA 导出");
  expect(await board.evaluate((element) => element.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
  await expect(listTab).toHaveAttribute("aria-selected", "true");
  const dormitorySection = page.locator('section[aria-label="宿舍"]');
  await dormitorySection.locator('button[aria-expanded="true"]').click();
  await dormitorySection.getByRole("button", { name: "暂不显示" }).click();
  const restoreHidden = page.getByRole("button").filter({ hasText: "恢复已隐藏" });
  await expect(restoreHidden).toBeVisible();

  if (browserName === "webkit") {
    await expectCapturedStyleMotion(page, "plan-summary");
    await expectCapturedStyleMotion(page, "plan-metrics");
  } else {
    await expectCapturedMotion(page, "plan-summary", 460, 40);
    await expectCapturedMotionDelays(page, "plan-metrics", 360, [100, 150, 215, 280]);
  }
  const renderingBudget = await page.evaluate(() => {
    const summaryElement = document.querySelector<HTMLElement>("[data-plan-summary]")!;
    const boardElement = document.querySelector<HTMLElement>("[data-plan-board]")!;
    const summaryCalligraphCount = summaryElement.querySelectorAll("[data-calligraph]").length;
    const boardCalligraphCount = boardElement.querySelectorAll("[data-calligraph]").length;
    const roomPrimaryCount = boardElement.querySelectorAll("[data-room-primary-efficiency]").length;
    const animatedTextCalligraphCount = document.querySelectorAll('[data-animated-value="text"] [data-calligraph]').length;
    const clipPathAnimationCount = [summaryElement, boardElement]
      .flatMap((element) => element.getAnimations({ subtree: true }))
      .filter((animation) => {
        const effect = animation.effect;
        return effect instanceof KeyframeEffect && effect.getKeyframes().some((frame) => (
          typeof frame.clipPath === "string" && frame.clipPath !== "none"
        ));
      }).length;
    return {
      animatedTextCalligraphCount,
      boardCalligraphCount,
      clipPathAnimationCount,
      roomPrimaryCount,
      summaryCalligraphCount,
      totalCalligraphCount: document.querySelectorAll("[data-calligraph]").length,
      totalElementCount: document.querySelectorAll("*").length,
    };
  });
  expect(renderingBudget.summaryCalligraphCount).toBe(5);
  expect(renderingBudget.boardCalligraphCount).toBe(renderingBudget.roomPrimaryCount);
  expect(renderingBudget.totalCalligraphCount).toBe(
    renderingBudget.summaryCalligraphCount + renderingBudget.boardCalligraphCount
  );
  expect(renderingBudget.totalCalligraphCount).toBeLessThanOrEqual(20);
  expect(renderingBudget.animatedTextCalligraphCount).toBe(0);
  expect(renderingBudget.clipPathAnimationCount).toBe(0);
  expect(renderingBudget.totalElementCount).toBeLessThan(1_500);

  await page.waitForTimeout(650);
  await board.evaluate((element) => {
    element.setAttribute("data-motion-sentinel", "stable");
  });
  await armTransientStyleCapture(page, "[data-plan-board] [data-operator-identity]", "shift-slots");
  const operatorIdentitiesBefore = await board.locator("[data-operator-identity]").evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute("data-operator-identity"))
  ));
  const firstShift = page.getByRole("tab", { name: /第 1 班 · 12h/ });
  const secondShift = page.getByRole("tab", { name: /第 2 班 · 6h/ });
  const thirdShift = page.getByRole("tab", { name: /第 3 班 · 6h/ });
  await expect(page.getByText("最近记录", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/较上次求解变更/)).toHaveCount(0);
  await expect(page.locator("[data-schedule-toolbar] [data-shift-tabs]")).toBeVisible();
  await secondShift.click();
  await expect(secondShift).toHaveAttribute("aria-selected", "true");
  await expect(listTrainingRoom.locator('[data-position="训练位"]')).toContainText("Training-B");
  const emptyTrainerPosition = listTrainingRoom.locator('[data-position="协助位"]');
  await expect(emptyTrainerPosition).not.toContainText("空置");
  await expect(emptyTrainerPosition.locator('[aria-label="协助位：空置"]')).toHaveCount(1);
  await expect(board).toHaveAttribute("data-motion-sentinel", "stable");
  expect(await board.evaluate((element) => element.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
  await expectCapturedStyleMotion(page, "shift-slots");
  await expect.poll(() => board.locator("[data-operator-identity]").evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute("data-operator-identity"))
  ))).not.toEqual(operatorIdentitiesBefore);

  await firstShift.click();
  await thirdShift.click();
  await secondShift.click();
  await expect(secondShift).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(320);
  await expect(board.locator('[data-operator-identity="凯尔希"]').first()).toBeVisible();
  await expect(board.locator('[data-operator-identity="阿米娅"], [data-operator-identity="贝洛内"]')).toHaveCount(0);
  await page.getByRole("tab", { name: "一图流布局" }).click();
  await expect(board).toHaveAttribute("data-motion-sentinel", "stable");
  expect(await board.evaluate((element) => element.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
  const compactView = board.locator('[data-schedule-view="compact"]');
  await expect(compactView).toBeVisible();
  await expect(compactView).toHaveAttribute("data-schedule-view-transition", "skeleton");
  expect(await compactView.evaluate((element) => element.getAnimations().length)).toBe(0);
  const compactTrainingRoom = compactView.locator('[data-room-group="training"]');
  await expect(compactTrainingRoom).toBeVisible();
  await expect(compactTrainingRoom.locator('[data-position="训练位"]')).toContainText("Training-B");
  await expect(compactView.locator(".compact-auxiliary-grid")).toHaveCSS("grid-template-columns", /px/);
  const auxiliaryGrid = compactView.locator(".compact-auxiliary-grid");
  await expect.poll(() => auxiliaryGrid.evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
    leftRows: new Set(Array.from(element.querySelectorAll(':scope > [data-room-group="meeting"], :scope > [data-room-group="training"], :scope > [data-room-group="recycling"]')).map((child) => child.getBoundingClientRect().y)).size,
    rightRows: new Set(Array.from(element.querySelectorAll(':scope > [data-room-group="hire"], :scope > [data-room-group="processing"]')).map((child) => child.getBoundingClientRect().y)).size,
    fits: element.scrollWidth <= element.clientWidth + 1,
  }))).toEqual({ columns: 2, leftRows: 3, rightRows: 2, fits: true });
  for (const group of ["hire", "processing"]) {
    const avatar = auxiliaryGrid.locator(`[data-room-group="${group}"] .infra-operator-slot`).first();
    await expect.poll(() => avatar.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(64);
  }

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(board.locator('[data-schedule-view="list"]')).toBeVisible();
  await expect(board.locator('[data-schedule-view="compact"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(board.locator('[data-schedule-view="list"]')).toBeVisible();
  await expect(board.locator('[data-schedule-view="compact"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(invalidTransformWarnings).toEqual([]);
});

test("reduced motion keeps feedback timing while removing movement, clipping, and staggering", async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApis(page);
  let releasePlan!: () => void;
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  await page.route("**/api/plan", async (route) => {
    await planGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: twoShiftPlanData, requestId }),
    });
  });
  await seedV4Session(page, null);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");

  await page.getByRole("button", { name: "生成排班" }).click();
  await expect(page.locator('[data-slot="live-activity"]')).toHaveAttribute("data-activity-phase", "running");
  await expect(page.locator('[data-slot="live-activity"] .animate-spin')).toHaveCount(0);
  const reducedRing = page.locator('[data-slot="status-mark-rail"] .status-mark__ring');
  const reducedOffset = await reducedRing.getAttribute("stroke-dashoffset");
  await page.waitForTimeout(160);
  await expect(reducedRing).toHaveAttribute("stroke-dashoffset", reducedOffset ?? "0");

  const board = page.locator("[data-plan-board]");
  await expect(board).toBeVisible();
  await expect(board).not.toHaveAttribute("data-plan-revision", /.+/);

  if (browserName === "webkit") {
    await armTransientStyleCapture(page, "[data-plan-summary]", "reduced-summary");
    await armTransientStyleCapture(page, "[data-plan-metric]", "reduced-metric");
  } else {
    await armMotionCapture(page, "[data-plan-summary]", "reduced-summary", 140);
    await armMotionCapture(page, "[data-plan-metric]", "reduced-metric", 140);
  }
  releasePlan();
  await expect(page.locator('[data-slot="live-activity"]')).toHaveAttribute("data-activity-phase", "success");
  const summary = page.locator("[data-plan-summary]");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("data-plan-entrance", "animated");
  await expect(board).toHaveAttribute("data-plan-revision", diagnosticId);
  expect(await board.evaluate((element) => element.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
  if (browserName === "webkit") {
    await expectCapturedStyleMotion(page, "reduced-summary");
    await expectCapturedStyleMotion(page, "reduced-metric");
  } else {
    await expectCapturedMotion(page, "reduced-summary", 140);
    await expectCapturedMotion(page, "reduced-metric", 140);
  }
  const reduced = await page.evaluate(() => {
    const activity = document.querySelector<HTMLElement>('[data-slot="live-activity"]')!;
    const boardElement = document.querySelector<HTMLElement>("[data-plan-board]")!;
    const movingFrames = boardElement.getAnimations({ subtree: true }).flatMap((animation) => {
      const effect = animation.effect;
      return effect instanceof KeyframeEffect ? effect.getKeyframes() : [];
    }).filter((frame) => (
      (typeof frame.transform === "string" && !["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(frame.transform))
      || (typeof frame.clipPath === "string" && frame.clipPath !== "none")
    ));
    return {
      activityAnimationCount: activity?.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length ?? 0,
      movingFrameCount: movingFrames.length,
      calligraphCount: boardElement.querySelectorAll("[data-calligraph]").length,
    };
  });
  expect(reduced.activityAnimationCount).toBe(0);
  expect(reduced.movingFrameCount).toBe(0);
  expect(reduced.calligraphCount).toBe(0);
});

test("live activity survives navigation and calculator search occupies the released toolbar space", async ({ page }) => {
  await mockApis(page);
  let releasePlan!: () => void;
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  await page.route("**/api/plan", async (route) => {
    await planGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: twoShiftPlanData, requestId }),
    });
  });
  await seedV4Session(page, null);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.locator('[data-slot="live-activity"]')).toHaveCount(0);
  await page.getByRole("button", { name: "生成排班" }).click();
  const activity = page.locator('[data-slot="live-activity"]');
  await expect(activity).toHaveAttribute("data-activity-phase", "running");

  await page.getByRole("button", { name: "技能查询" }).click();
  await expect(page.getByRole("heading", { name: "技能查询" })).toBeVisible();
  await expect(activity).toHaveAttribute("data-activity-phase", "running");
  releasePlan();
  await expect(activity).toHaveAttribute("data-activity-phase", "success");
  await expect(activity).toHaveCount(0, { timeout: 5_000 });

  await expect(page.getByRole("textbox", { name: "搜索干员名称" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "制造站", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "基建计算器", exact: true }).click();
  const search = page.getByRole("textbox", { name: "搜索排班中的干员或房间" });
  const toolbar = page.locator("[data-calculator-controls]");
  await expect(search).toBeVisible();
  for (const buttonName of ["配置Box与布局", "生成排班"]) {
    await expect(toolbar.getByRole("button", { name: buttonName })).toHaveCSS("height", "36px");
  }
  await expect(page.locator('[data-calculator-export-actions="desktop"]').getByRole("button", { name: "导出到 MAA" })).toHaveCSS("height", "28px");
  await expect(page.getByRole("button", { name: "全角色导入" })).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(search).toBeFocused();
  await search.fill("阿米娅");
  await expect(page.locator("[data-plan-board]")).toContainText("阿米娅");
  await expect(page.getByRole("button", { name: "清空排班搜索" })).toBeVisible();
  await page.getByRole("button", { name: "清空排班搜索" }).click();
  await expect(search).toHaveValue("");

  await page.getByRole("button", { name: "查看快捷键" }).click();
  const shortcutDialog = page.getByRole("dialog");
  await expect(shortcutDialog).toBeVisible();
  await expect(shortcutDialog).toHaveCSS("max-width", "672px");
  await expect(shortcutDialog.locator('[data-slot="kbd"]')).toHaveCount(5);
  await expect(shortcutDialog.locator('[data-slot="kbd-group"]')).toHaveCount(2);
  const shortcutRows = shortcutDialog.locator('[data-slot="kbd-group"]').first().locator("xpath=..");
  await expect(shortcutRows).toHaveCSS("min-height", "56px");
  await page.keyboard.press("Escape");
  await expect(shortcutDialog).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileToolbar = await toolbar.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(mobileToolbar.scroll).toBeLessThanOrEqual(mobileToolbar.client);
  await expect(search).toBeHidden();
  const searchToggle = toolbar.getByRole("button", { name: "搜索排班中的干员或房间", exact: true });
  await searchToggle.click();
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS("height", "44px");
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(searchToggle).toBeFocused();
});

test("failed plan remains expanded with retry and diagnostic actions", async ({ page }) => {
  await mockApis(page);
  let requestCount = 0;
  await page.route("**/api/plan", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "AIC-PLAN-3001", message: "排班服务暂不可用，请稍后重试。", retryable: true },
          requestId,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: twoShiftPlanData, requestId }),
    });
  });
  await seedV4Session(page, null);
  await page.goto("/");
  await page.getByRole("button", { name: "生成排班" }).click();

  const activity = page.locator('[data-slot="live-activity"]');
  await expect(activity).toHaveAttribute("data-activity-phase", "error");
  await expect(activity).toHaveAttribute("data-activity-view", "expanded");
  await expect(activity.locator('[data-slot="status-mark-rail"] [data-live-activity-icon]')).toHaveAttribute("data-status", "failed");
  await page.waitForTimeout(2_800);
  await expect(activity).toHaveAttribute("data-activity-view", "expanded");
  await activity.hover();
  await expect(activity).toHaveAttribute("data-activity-view", "expanded");
  await activity.getByRole("button", { name: "复制诊断" }).click();
  await expect(activity.getByRole("button", { name: "已复制" })).toBeVisible();
  await activity.getByRole("button", { name: "重试" }).click();
  await expect(page.locator('[data-slot="live-activity"][data-activity-phase="success"]')).toBeVisible();
});

test("dialog and mobile sheet motion preserve direction, exit timing, and focus", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, scheduleVisualPlanData, { boxSource: "maa" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const setupTrigger = page.getByRole("button", { name: "配置Box与布局" }).first();
  await setupTrigger.click();
  const setupDialog = page.getByRole("dialog");
  await expect(setupDialog).toBeVisible({ timeout: 30_000 });
  await expect(setupDialog).toHaveCSS("transform-origin", /.+/);
  await setupDialog.getByRole("button", { name: "Close" }).click();
  await expect(setupDialog).toHaveCount(0);
  await expect(setupTrigger).toBeFocused();

  await armMotionCapture(page, '[role="dialog"]', "setup-enter", 200);
  await setupTrigger.click();
  await expectCapturedMotion(page, "setup-enter", 200);
  await expect(setupDialog).toHaveCSS("transform-origin", /.+/);
  await page.setViewportSize({ width: 768, height: 900 });
  await armEndingTransitionCapture(setupDialog, "setup");
  await setupDialog.getByRole("button", { name: "Close" }).click();
  await expectCapturedExitDuration(page, "setup", 150);
  await expect(setupDialog).toHaveCount(0);
  await expect(setupTrigger).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: "列表式布局" }).click();
  const issueTrigger = page.getByRole("button", { name: /反馈排班问题/ }).first();
  await issueTrigger.click();
  const feedbackDialog = page.getByRole("dialog");
  await expect(feedbackDialog).toBeVisible({ timeout: 30_000 });
  await feedbackDialog.getByRole("button", { name: "取消" }).click();
  await expect(feedbackDialog).toHaveCount(0);
  await expect(issueTrigger).toBeFocused();

  await armMotionCapture(page, '[role="dialog"]', "feedback-enter", 200);
  await issueTrigger.click();
  await expectCapturedMotion(page, "feedback-enter", 200);
  await armEndingTransitionCapture(feedbackDialog, "feedback");
  await feedbackDialog.getByRole("button", { name: "取消" }).click();
  await expectCapturedExitDuration(page, "feedback", 150);
  await expect(feedbackDialog).toHaveCount(0);
  await expect(issueTrigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const sidebarTrigger = page.getByRole("button", { name: "Toggle Sidebar" });
  await armMotionCapture(page, '[data-mobile="true"][data-sidebar="sidebar"]', "sidebar-enter", 320);
  await sidebarTrigger.click();
  const sheet = page.locator('[data-mobile="true"][data-sidebar="sidebar"]');
  await expect(sheet).toHaveAttribute("data-side", "left");
  await expectCapturedMotion(page, "sidebar-enter", 320);
  await armEndingTransitionCapture(sheet, "sidebar");
  await page.keyboard.press("Escape");
  await expectCapturedExitDuration(page, "sidebar", 220);
  await expect(sheet).toHaveCount(0);
  await expect(sidebarTrigger).toBeFocused();
});

test("shared action buttons keep their geometry after WebKit interactions", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const moreTools = page.locator("[data-calculator-more-tools]");
  await moreTools.getByLabel("更多工具", { exact: true }).click();
  const setupTrigger = moreTools.getByRole("button", { name: "配置Box与布局" });
  await setupTrigger.click();
  const setupDialog = page.getByRole("dialog");
  await expect(setupDialog).toBeVisible();
  await setupDialog.getByRole("button", { name: "Close" }).click();
  await expect(setupDialog).toHaveCount(0);
  await expect(setupTrigger).toBeFocused();
  await expectButtonGeometryStable(setupTrigger);
  await moreTools.getByLabel("更多工具", { exact: true }).click();

  const planButton = page.getByRole("button", { name: "生成排班" });
  await expect(planButton).toBeEnabled();
  await expectButtonGeometryStable(planButton);
  await planButton.click();
  await expect(page.getByRole("status", { name: "排班已生成", exact: true })).toBeVisible();
  await expectButtonGeometryStable(planButton);
});

test("tooltips wait once and then open adjacent help instantly within the provider window", async ({ page, browserName, context }) => {
  await mockApis(page);
  await seedPreferences(page);
  await context.addCookies([{ name: "sidebar_state", value: "false", domain: "127.0.0.1", path: "/" }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const calculatorTrigger = page.getByRole("button", { name: "基建计算器" });
  const adviceTrigger = page.getByRole("button", { name: "练卡建议" });
  await expect(calculatorTrigger).toBeVisible();
  await calculatorTrigger.evaluate((trigger) => {
    const root = document.documentElement;
    root.removeAttribute("data-tooltip-entered-at");
    root.removeAttribute("data-tooltip-open-delay");
    const markEntered = () => {
      if (!root.hasAttribute("data-tooltip-entered-at")) {
        root.setAttribute("data-tooltip-entered-at", String(performance.now()));
      }
    };
    trigger.addEventListener("pointerenter", markEntered, { once: true });
    trigger.addEventListener("mouseenter", markEntered, { once: true });
    const observer = new MutationObserver(() => {
      const enteredAt = Number(root.getAttribute("data-tooltip-entered-at"));
      if (!enteredAt || !document.querySelector('[data-slot="tooltip-content"][data-open]')) return;
      root.setAttribute("data-tooltip-open-delay", String(performance.now() - enteredAt));
      observer.disconnect();
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  });
  if (browserName === "webkit") {
    await armTransientStyleCapture(page, '[data-slot="tooltip-content"][data-open]', "tooltip");
  } else {
    await armMotionCapture(page, '[data-slot="tooltip-content"][data-open]', "tooltip", 240);
  }
  await page.mouse.move(1200, 850);
  await calculatorTrigger.hover();
  const firstTooltip = page.locator('[data-slot="tooltip-content"][data-open]');
  await expect(firstTooltip).toBeVisible({ timeout: 10_000 });
  if (browserName === "webkit") {
    await expectCapturedStyleMotion(page, "tooltip");
  } else {
    await expectCapturedMotion(page, "tooltip", 240);
  }
  await expect(page.locator("html")).toHaveAttribute("data-tooltip-open-delay", /.+/);
  const firstOpenDelay = Number(await page.locator("html").getAttribute("data-tooltip-open-delay"));
  expect(firstOpenDelay).toBeGreaterThanOrEqual(300);
  expect(firstOpenDelay).toBeLessThan(1_200);

  await adviceTrigger.hover();
  const instantTooltip = page.locator('[data-slot="tooltip-content"][data-instant][data-open]');
  await expect(instantTooltip).toBeVisible({ timeout: 200 });
  expect(await instantTooltip.evaluate((node) => node.getAnimations().every((animation) => (
    Number(animation.effect?.getTiming().duration ?? 0) === 0
  )))).toBe(true);
});

test("a stored sample BOX completes generation, shifts, MAA export, and disables feedback", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, null);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "全角色导入" })).toHaveCount(0);
  await expect(page.getByText("先导入干员数据")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "列表式布局" })).toBeVisible();
  await expect(page.locator("[data-plan-board]")).not.toHaveAttribute("data-plan-revision", /.+/);
  await page.getByRole("button", { name: "生成排班" }).click();
  await expect(page.getByRole("status", { name: "排班已生成", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "列表式布局" }).click();

  const secondShift = page.getByRole("tab", { name: /第 2 班 · 6h/ });
  await secondShift.click();
  await expect(secondShift).toHaveAttribute("aria-selected", "true");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出到 MAA" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("arknights-infra-schedule-maa.json");
  const downloadStream = await download.createReadStream();
  const downloadChunks: Buffer[] = [];
  for await (const chunk of downloadStream) downloadChunks.push(Buffer.from(chunk));
  const downloadedMaa = JSON.parse(Buffer.concat(downloadChunks).toString("utf8")) as {
    plans?: Array<{ rooms?: Record<string, unknown> }>;
  };
  expect(downloadedMaa.plans?.every((plan) => !("training" in (plan.rooms ?? {})))).toBe(true);

  const feedbackButton = page.getByRole("button", { name: "加工站 反馈排班问题" });
  await expect(feedbackButton).toBeDisabled();
  await feedbackButton.locator("xpath=..").hover();
  await expect(page.getByText("全角色导入为体验数据，不能提交反馈")).toBeVisible();
});

test("plan timing stays passive and performance feedback waits for result details to close", async ({ page }) => {
  await mockApis(page);
  const feedbackPayloads: Record<string, unknown>[] = [];
  await page.unroute("**/api/feedback");
  await page.route("**/api/feedback", async (route) => {
    feedbackPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { feedbackId: "feedback-performance", savedAt: "2026-08-20T00:00:00.000Z" },
        requestId,
      }),
    });
  });
  await seedV4Session(page, { ...planData, durationMs: 2764 }, { boxSource: "maa" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const resultSummary = page.locator("[data-plan-primary-details-trigger]");
  await expect(resultSummary).toContainText("用时 2.8 秒 · 点击查看详情");
  await expect(page.getByText(/本次求解耗时/)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(feedbackPayloads).toHaveLength(0);

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await resultSummary.click();
    const detailsDrawer = page.getByRole("dialog", { name: "排班结果详情" });
    const performanceAction = detailsDrawer.getByRole("button", { name: "反馈本次求解速度" });
    await expect(performanceAction).toBeVisible();
    const horizontalFit = await detailsDrawer.evaluate((element) => {
      const action = element.querySelector<HTMLElement>("[data-plan-performance-feedback]");
      if (!action) throw new Error("Missing performance feedback action");
      const drawerBox = element.getBoundingClientRect();
      const actionBox = action.getBoundingClientRect();
      return {
        left: actionBox.left >= drawerBox.left,
        right: actionBox.right <= drawerBox.right + 1,
      };
    });
    expect(horizontalFit).toEqual({ left: true, right: true });
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="drawer-root"]')).toHaveCount(0);
    await expect(resultSummary).toBeFocused();
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await resultSummary.press("Enter");
  const detailsDrawer = page.getByRole("dialog", { name: "排班结果详情" });
  const performanceAction = detailsDrawer.getByRole("button", { name: "反馈本次求解速度" });
  await performanceAction.focus();
  await page.keyboard.press("Enter");
  const feedbackDialog = page.getByRole("dialog", { name: "提交性能反馈" });
  await expect(feedbackDialog).toBeVisible();
  await expect(detailsDrawer).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(feedbackPayloads).toHaveLength(0);
  await expect(feedbackDialog.getByText(/将提交你的说明，以及包含.*私有复现快照/)).toBeVisible();
  await expect(feedbackDialog.getByText(/最长保留 30 天/)).toBeVisible();
  await feedbackDialog.getByRole("textbox").fill("同一份 Box 之前通常可以更快完成。");
  await feedbackDialog.getByRole("checkbox").check();
  await feedbackDialog.getByRole("button", { name: "提交反馈" }).click();

  await expect.poll(() => feedbackPayloads).toHaveLength(1);
  const feedbackPayload = feedbackPayloads[0];
  expect(feedbackPayload).toMatchObject({
    kind: "performance_issue",
    diagnosticId,
    consent: true,
    reproduction: {
      layout: { template: "243" },
      rotation: "abc_12_6_6",
      fiammettaEnabled: false,
      sourceType: "maa",
    },
  });
  expect(feedbackPayload).not.toHaveProperty("room");
  expect((feedbackPayload.reproduction as { operbox?: unknown[] }).operbox?.length).toBeGreaterThan(0);
  expect(feedbackPayload?.note).toContain("求解耗时：2764 ms");
  await expect(page.getByText("反馈已提交，编号：feedback-performance")).toBeVisible();
  await expect(resultSummary).toBeFocused();
});

test("scheduled product changes require destructive confirmation and rerun with the updated layout", async ({ page }) => {
  test.setTimeout(60_000);
  await mockApis(page);
  let planRequests = 0;
  let rerunPayload: Record<string, unknown> | null = null;
  let releaseRerun: (() => void) | undefined;
  const rerunGate = new Promise<void>((resolve) => {
    releaseRerun = resolve;
  });
  await page.route("**/api/plan", async (route) => {
    planRequests += 1;
    if (planRequests === 2) {
      rerunPayload = route.request().postDataJSON() as Record<string, unknown>;
      await rerunGate;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: productChangePlanData, requestId }),
    });
  });
  await seedV4Session(page, null);
  await page.setViewportSize({ width: 1088, height: 900 });
  await page.goto("/");

  await page.getByRole("button", { name: "生成排班" }).click();
  await expect(page.getByRole("status", { name: "排班已生成", exact: true })).toBeVisible();
  await expect.poll(() => planRequests).toBe(1);
  await page.getByRole("tab", { name: "列表式布局" }).click();

  const factoryControls = page.getByRole("group", { name: "制造站 1 配方" });
  await factoryControls.getByRole("button", { name: "作战记录" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await expectUnifiedDialogTypography(confirmation);
  await expect(confirmation.getByRole("heading", { name: "更改配置并重新排班？" })).toBeVisible();
  await expect(confirmation).toContainText("制造站 1 的制造配方将切换为「作战记录」");
  const confirmationFooter = confirmation.locator('[data-slot="dialog-footer"]');
  await expect(confirmationFooter).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(confirmationFooter).toHaveCSS("border-top-width", "0px");
  await expect(confirmationFooter).toHaveCSS("box-shadow", "none");
  await expectUnifiedDialogAction(confirmation.getByRole("button", { name: "取消" }), { height: "46px" });
  await expectUnifiedDialogAction(confirmation.getByRole("button", { name: "确认并重新排班" }), { width: "196px", height: "46px" });
  await expect(confirmation.getByRole("button", { name: "确认并重新排班" })).toHaveClass(/text-destructive/);
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(confirmation).toBeHidden();
  expect(planRequests).toBe(1);
  await expect(factoryControls.getByRole("button", { name: "贵金属" })).toHaveAttribute("aria-pressed", "true");

  const tradeControls = page.getByRole("group", { name: "贸易站 1 订单" });
  await tradeControls.getByRole("button", { name: "开采协力" }).click();
  await expect(confirmation).toContainText("贸易站 1 的贸易策略将切换为「开采协力」");
  await confirmation.getByRole("button", { name: "确认并重新排班" }).click();
  await expect.poll(() => planRequests).toBe(2);
  await expect(confirmation).toHaveAttribute("aria-busy", "true");
  await expect(confirmation.getByRole("button", { name: "重新排班中" })).toBeDisabled();

  const rerunLayout = (rerunPayload as Record<string, unknown> | null)?.layout as { rooms?: Array<{ id?: string; product?: { trade?: { order?: string } } }> } | undefined;
  expect(rerunLayout?.rooms?.find((room) => room.id === "trade_1")?.product?.trade?.order).toBe("originium");
  releaseRerun?.();
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole("status", { name: "排班已生成", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "列表式布局" }).click();
  const updatedTradeControls = page.getByRole("group", { name: "贸易站 1 订单" });
  await expect(updatedTradeControls.getByRole("button", { name: "开采协力" })).toHaveAttribute("aria-pressed", "true");
});

test("responsive navigation and the two locked areas keep their current behavior", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const history: string[] = [];
    Object.defineProperty(window, "__scheduleViewHistory", { value: history, configurable: true });
    const capture = () => {
      const mode = document.querySelector<HTMLElement>("[data-schedule-view]")?.dataset.scheduleView;
      if (mode && history.at(-1) !== mode) history.push(mode);
    };
    const observer = new MutationObserver(capture);
    observer.observe(document, { attributes: true, childList: true, subtree: true });
  });
  await mockApis(page);
  await seedV4Session(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const listViewTab = page.getByRole("tab", { name: "列表式布局" });
  const compactViewTab = page.getByRole("tab", { name: "一图流布局" });
  await expect(compactViewTab).toHaveCount(0);
  await expect(listViewTab).toHaveCount(0);
  await expect(page.locator('[data-schedule-view="list"]')).toBeVisible();
  await expect(page.locator('[data-schedule-view="compact"]')).toHaveCount(0);
  await expect(page.locator("[data-compact-schedule-loading]")).toHaveCount(0);
  const mobileViewHistory = await page.evaluate(() => (
    (window as Window & { __scheduleViewHistory?: string[] }).__scheduleViewHistory ?? []
  ));
  expect(mobileViewHistory).toEqual(["list"]);
  await expect(page.locator('[data-schedule-view="list"] [data-room-group="processing"]').getByText("加工站", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /加工站/ }).first().click();
  const keepHiddenButton = page.getByRole("button", { name: "暂不显示" });
  await expect(keepHiddenButton).toBeVisible();
  await keepHiddenButton.click();
  await expect(page.getByRole("button", { name: /恢复已隐藏.*1/ })).toBeVisible();

  await page.setViewportSize({ width: 768, height: 900 });
  await page.reload();
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
  await expect(page.locator('[data-slot="live-activity"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "全角色导入" })).toHaveCount(0);
  await expect(compactViewTab).toHaveCount(0);
  await expect(listViewTab).toHaveCount(0);
  await expect(page.locator('[data-schedule-view="list"]')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(compactViewTab).toBeEnabled();
  await expect(compactViewTab).toHaveAttribute("aria-selected", "true");
  await listViewTab.click();
  await expect(listViewTab).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(compactViewTab).toHaveCount(0);
  await expect(page.locator('[data-schedule-view="list"]')).toBeVisible();
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(listViewTab).toHaveCount(0);
  await expect(compactViewTab).toHaveCount(0);
  await expect(page.locator('[data-schedule-view="list"]')).toBeVisible();
  await page.reload();
  await expect(listViewTab).toHaveCount(0);
  await expect(compactViewTab).toHaveCount(0);
  await expect(page.locator('[data-schedule-view="list"]')).toBeVisible();

  await expect(page.getByRole("button", { name: "基建计算器" })).toBeVisible();
  await expect(page.getByRole("button", { name: "练卡建议" })).toBeVisible();
  await expect(page.getByRole("button", { name: "森空岛状态中心", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "账号管理", exact: true })).toBeVisible();
});

test("the compact mobile navigation stays pinned while the account control belongs to the calculator", async ({ page }) => {
  test.setTimeout(60_000);
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
    sklandSessionDelayMs: 4_000,
  });
  await seedV4Session(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const topbar = page.locator("[data-app-topbar]");
  await expect(topbar).toBeVisible({ timeout: 15_000 });
  const topbarStyle = await topbar.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderBottomWidth: style.borderBottomWidth,
      boxShadow: style.boxShadow,
    };
  });
  expect(topbarStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(topbarStyle.borderBottomWidth).toBe("1px");
  expect(topbarStyle.boxShadow).toBe("none");
  await expect(topbar.locator("[data-skland-account-control]")).toHaveCount(0);
  await expect(page.locator("[data-skland-account-control]")).toHaveAttribute(
    "aria-label",
    "测试博士，进入森空岛状态中心",
    { timeout: 10_000 },
  );
  await expect(page.locator("[data-skland-account-loading]")).toHaveCount(0);
  await expect(page.locator("[data-skland-sidebar-account]")).toHaveCount(0);

  const mobileBar = topbar.locator(".app-content-track");
  await expect(mobileBar).toHaveCSS("height", "48px");

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => (await topbar.boundingBox())?.y ?? -1).toBeCloseTo(0, 0);

  for (const destination of ["练卡建议", "森空岛状态中心", "账号管理"]) {
    await topbar.getByRole("button", { name: "Toggle Sidebar" }).click();
    await page.getByRole("button", { name: destination, exact: true }).click();
    await expect(page.locator("[data-skland-account-control]")).toHaveCount(0);
  }
  await topbar.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("button", { name: "基建计算器", exact: true }).click();
  await expect(page.locator("[data-skland-account-control]")).toBeVisible();

  await page.setViewportSize({ width: 768, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(topbar).toBeHidden();
  await expect.poll(async () => (await page.locator("[data-app-content]").boundingBox())?.y ?? -1).toBeCloseTo(0, 0);
});

test("the initial onboarding is full-screen while other primary pages keep one content offset", async ({ page }) => {
  test.setTimeout(60_000);
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: authenticatedSklandSnapshot });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
    const calculatorTop = (await page.locator('[data-primary-page="calculator"]').boundingBox())?.y ?? -1;
    const regularPageTops: number[] = [];

    for (const destination of [
      { name: "练卡建议", pageKey: "training", root: "[data-training-page]" },
      { name: "技能查询", pageKey: "skill-query", root: "[data-skill-query-page]" },
      { name: "森空岛状态中心", pageKey: "skland", root: "[data-skland-page]" },
      { name: "账号管理", pageKey: "account", root: "[data-account-management]" },
    ]) {
      const href = destination.pageKey === "skill-query" ? "/skills" : `/${destination.pageKey}`;
      await navigateToPrimaryPage(page, {
        name: destination.name,
        href,
        root: destination.root,
      }, viewport.width < 768);
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitForOwnAnimations(page.locator(`[data-primary-page="${destination.pageKey}"]`));
      const pageTop = (await page.locator(`[data-primary-page="${destination.pageKey}"]`).boundingBox())?.y ?? -1;
      regularPageTops.push(pageTop);
    }

    for (const [index, pageTop] of regularPageTops.entries()) {
      expect(pageTop, `${viewport.width}px regular page ${index + 1}`).toBeCloseTo(regularPageTops[0], 0);
    }
    expect(regularPageTops[0] - calculatorTop, `${viewport.width}px full-screen inset`).toBeCloseTo(16, 0);
  }
});

test("Skland and account centers share header geometry and account actions use technical cards", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: authenticatedSklandSnapshot });
  await seedPreferences(page);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);

    await navigateToPrimaryPage(page, {
      name: "森空岛状态中心",
      href: "/skland",
      root: "[data-skland-page]",
    }, viewport.width < 768);
    const sklandRoot = page.locator("[data-skland-page]");
    await waitForOwnAnimations(page.locator('[data-primary-page="skland"]'));
    const sklandHeader = sklandRoot.locator(":scope > header");
    const sklandLogout = sklandRoot.locator("[data-skland-logout]");
    await expect(sklandLogout).toBeVisible();
    const dialogButtonHeight = viewport.width < 640 ? "44px" : "46px";
    for (const label of ["前往生成排班", "继续配置布局"]) {
      await expect(sklandRoot.getByRole("button", { name: label })).toHaveCSS("height", dialogButtonHeight);
      await expect(sklandRoot.getByRole("button", { name: label })).toHaveCSS("border-radius", "22px");
    }
    const sklandGeometry = await Promise.all([
      sklandHeader.boundingBox(),
      sklandLogout.boundingBox(),
    ]);

    await navigateToPrimaryPage(page, {
      name: "账号管理",
      href: "/account",
      root: "[data-account-management]",
    }, viewport.width < 768);
    const accountRoot = page.locator("[data-account-management]");
    await waitForOwnAnimations(page.locator('[data-primary-page="account"]'));
    const accountHeader = accountRoot.locator("header").first();
    const accountLogout = accountRoot.locator("[data-account-logout]");
    await expect(accountLogout).toBeVisible();
    const accountGeometry = await Promise.all([
      accountHeader.boundingBox(),
      accountLogout.boundingBox(),
    ]);

    expect(accountGeometry[0]?.y).toBeCloseTo(sklandGeometry[0]?.y ?? 0, 0);
    expect(accountGeometry[0]?.height).toBeCloseTo(sklandGeometry[0]?.height ?? 0, 0);
    expect(accountGeometry[1]?.y).toBeCloseTo(sklandGeometry[1]?.y ?? 0, 0);
    expect(accountGeometry[1]?.height).toBeCloseTo(sklandGeometry[1]?.height ?? 0, 0);
    expect((accountGeometry[1]?.x ?? 0) + (accountGeometry[1]?.width ?? 0))
      .toBeCloseTo((sklandGeometry[1]?.x ?? 0) + (sklandGeometry[1]?.width ?? 0), 0);

    const actionCards = accountRoot.locator("[data-account-action-cards] [data-infra-technical-card]");
    await expect(actionCards).toHaveCount(2);
    await expect(actionCards.nth(0).getByRole("heading", { name: "登录设备" })).toBeVisible();
    await expect(actionCards.nth(1).getByRole("heading", { name: "永久注销账号" })).toBeVisible();
    for (const label of ["退出全部设备", "永久注销账号"]) {
      await expect(accountRoot.getByRole("button", { name: label })).toHaveCSS("height", dialogButtonHeight);
      await expect(accountRoot.getByRole("button", { name: label })).toHaveCSS("border-radius", "22px");
    }
  }
});
