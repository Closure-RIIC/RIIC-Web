import { expect, test } from "@playwright/test";
import { mockApis, scheduleVisualPlanData, seedV4Session } from "./production-readiness.fixture";

declare global {
  interface Window {
    roomTransitionSamples: Array<{ changingBounds: boolean; imageFit: string; rootAnimated: boolean; duration: number | string }>;
    pauseRoomTransition: boolean;
    roomTransitionAnimations: Animation[];
  }
}

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, scheduleVisualPlanData);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    window.roomTransitionSamples = [];
    window.pauseRoomTransition = false;
    window.roomTransitionAnimations = [];
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      const transition = start(update);
      void transition.ready.then(() => {
        const animations = document.getAnimations().filter(animation =>
          (animation.effect as KeyframeEffect)?.pseudoElement?.includes("view-transition"));
        window.roomTransitionAnimations.push(...animations);
        const groups = animations.filter(animation => (animation.effect as KeyframeEffect).pseudoElement?.includes("view-transition-group"));
        const room = document.querySelector<HTMLElement>('[data-schedule-room="trade_1"]');
        window.roomTransitionSamples.push({
          changingBounds: groups.some(animation => {
            const frames = (animation.effect as KeyframeEffect).getKeyframes();
            return frames[0].width !== frames.at(-1)?.width && frames[0].transform !== frames.at(-1)?.transform;
          }),
          imageFit: getComputedStyle(document.documentElement, `::view-transition-new(${room?.style.viewTransitionName})`).objectFit,
          rootAnimated: animations.some(animation => (animation.effect as KeyframeEffect).pseudoElement?.includes("(root)")),
          duration: Number(groups[0]?.effect?.getTiming().duration ?? 0),
        });
        if (window.pauseRoomTransition) for (const animation of animations) animation.pause();
      }).catch(() => {});
      return transition;
    };
  });
  await page.goto("/");
  await expect(page.locator('[data-compact-schedule-view]')).toBeVisible();
});

test("rooms morph in both directions without scaling snapshots or moving the whole page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const originalRoom = await page.locator('[data-schedule-room="trade_1"]').elementHandle();
  expect(await page.evaluate(() => window.roomTransitionSamples)).toEqual([]);
  for (const [index, name] of ["列表式布局", "一图流布局"].entries()) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.roomTransitionSamples.length)).toBe(index + 1);
    await expect(page.locator("html")).not.toHaveClass(/schedule-layout-transition/);
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => window.roomTransitionSamples.at(-1))).toEqual({ changingBounds: true, imageFit: "none", rootAnimated: false, duration: 360 });
    expect(await page.locator('[data-schedule-room][style*="view-transition-name"]').count()).toBe(0);
  }
  expect(await page.locator('[data-schedule-room="trade_1"]').evaluate((room, original) => room === original, originalRoom)).toBe(true);
  expect(errors).toEqual([]);
});

test("returning cards contract before newly visible rooms enter", async ({ page }) => {
  // The workshop is below the fold in the list, but visible beside the trade
  // room in the compact layout.
  await page.setViewportSize({ width: 1440, height: 450 });
  await page.getByRole("tab", { name: "列表式布局", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/schedule-layout-transition/);
  const initialWidth = await page.locator('[data-schedule-room="trade_1"]').evaluate(room => room.getBoundingClientRect().width);
  await page.evaluate(() => { window.pauseRoomTransition = true; });
  await page.getByRole("tab", { name: "一图流布局", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.roomTransitionSamples.length)).toBe(2);
  const midway = await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if ((animation.effect as KeyframeEffect)?.pseudoElement?.includes("view-transition")) {
        window.roomTransitionAnimations.push(animation);
        animation.pause();
        animation.currentTime = 90;
      }
    }
    const room = document.querySelector<HTMLElement>('[data-schedule-room="trade_1"]')!;
    const entering = document.querySelector<HTMLElement>('[style*="schedule-room-entering"]')!;
    const group = getComputedStyle(document.documentElement, `::view-transition-group(${room.style.viewTransitionName})`);
    const newRoom = getComputedStyle(document.documentElement, `::view-transition-new(${entering.style.viewTransitionName})`);
    return { width: parseFloat(group.width), targetWidth: room.getBoundingClientRect().width, enteringOpacity: Number(newRoom.opacity) };
  });
  expect(midway.width).toBeLessThan(initialWidth - (initialWidth - midway.targetWidth) * 0.8);
  expect(midway.enteringOpacity).toBe(0);
  // Reverse while the contraction override is active as well as the snapshots.
  await page.evaluate(() => {
    window.pauseRoomTransition = false;
    // Resume the animations paused for inspection before exercising a real
    // user reversal. WebKit keeps paused native animations alive after skip.
    for (const animation of window.roomTransitionAnimations) {
      if (animation.playState === "paused") animation.play();
    }
  });
  await page.getByRole("tab", { name: "列表式布局", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/schedule-layout-transition|schedule-layout-return/);
  await expect(page.locator('[data-schedule-view="list"]')).toBeVisible();
  expect(await page.locator('[data-schedule-room][style*="view-transition-"]').count()).toBe(0);
  // WebKit can crash enumerating removed view-transition pseudo-elements.
  // Check the captured native and width-override animations have all stopped.
  expect(await page.evaluate(() => window.roomTransitionAnimations.filter(animation =>
    animation.playState !== "finished" && animation.playState !== "idle").length)).toBe(0);
});

test("a second click can reverse an in-flight room transition", async ({ page }) => {
  await page.evaluate(() => { window.pauseRoomTransition = true; });
  await page.getByRole("tab", { name: "列表式布局", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.roomTransitionSamples.length)).toBe(1);
  await page.evaluate(() => { window.pauseRoomTransition = false; });
  await page.getByRole("tab", { name: "一图流布局", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/schedule-layout-transition/);
  await expect(page.locator('[data-compact-schedule-view]')).toBeVisible();
  await expect(page.getByRole("tab", { name: "一图流布局", exact: true })).toHaveAttribute("aria-selected", "true");
});

for (const fallback of ["reduced motion", "unsupported browser"]) {
  test(`layout switching still works with ${fallback}`, async ({ page }) => {
    if (fallback === "reduced motion") await page.emulateMedia({ reducedMotion: "reduce" });
    else await page.evaluate(() => { Object.defineProperty(document, "startViewTransition", { value: undefined }); });
    await page.getByRole("tab", { name: "列表式布局", exact: true }).click();
    await expect(page.locator('[data-schedule-view="list"]')).toBeVisible();
    await page.getByRole("tab", { name: "一图流布局", exact: true }).click();
    await expect(page.locator('[data-compact-schedule-view]')).toBeVisible();
    expect(await page.evaluate(() => window.roomTransitionSamples)).toEqual([]);
    await expect(page.locator("html")).not.toHaveClass(/schedule-layout-transition/);
  });
}
