import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoStable, mockApis, planData, seedV4Session } from "./production-readiness.fixture";

async function addSurfaces(page: Page) {
  await page.goto("/help");
  await page.evaluate(() => {
    const fixture = document.createElement("section");
    fixture.id = "scroll-fixture";
    fixture.style.cssText = "position:fixed;inset:80px auto auto 40px;z-index:100;width:320px;background:white;color:black";
    for (const direction of ["y", "x", "both"]) {
      const viewport = document.createElement("div");
      viewport.id = "scroll-" + direction;
      viewport.dataset.yeyeScroll = direction;
      viewport.style.cssText = "position:relative;width:300px;height:120px;overflow:auto;margin-bottom:12px";
      const content = document.createElement("div");
      content.style.cssText = "width:" + (direction === "y" ? "100%" : "1200px") + ";height:" + (direction === "x" ? "100%" : "900px");
      content.textContent = direction;
      viewport.append(content);
      fixture.append(viewport);
    }
    document.body.append(fixture);
  });
  if (!await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    await expect(page.locator("#scroll-y")).toHaveAttribute("data-overlayscrollbars-viewport", /scrollbarHidden/);
  }
}

async function drag(page: Page, viewport: Locator, axis: "x" | "y") {
  await viewport.hover();
  const handle = viewport.locator(axis === "x" ? ":scope > .os-scrollbar-horizontal .os-scrollbar-handle" : ":scope > .os-scrollbar-vertical .os-scrollbar-handle");
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (axis === "x" ? 70 : 0), y + (axis === "y" ? 55 : 0), { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => viewport.evaluate((node, axis) => axis === "x" ? node.scrollLeft : node.scrollTop, axis)).toBeGreaterThan(100);
}

test("nested dialog and dropdown keep keyboard navigation, background locking and cleanup", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1100, height: 600 });
  await mockApis(page);
  await page.route("**/api/auth/get-session", route => route.fulfill({
    json: {
      session: { expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      user: { id: "scroll-test", name: "Scroll test", email: "scroll@example.test", emailVerified: true },
    },
  }));
  await seedV4Session(page, planData);
  await gotoStable(page, "/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: /配置\s*Box\s*与布局/ }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog").filter({ has: page.locator('[data-slot="scroll-area"]') }).last();
    await expect(dialog).toBeVisible();
    const scroll = dialog.locator('[data-slot="scroll-area-viewport"]:visible').first();
    await expect(scroll).toHaveAttribute("data-overlayscrollbars-viewport", /scrollbarHidden/);
    await expect(scroll.locator(":scope > .os-scrollbar")).toHaveCount(2);
    const backgroundViewport = page.locator("[data-app-scroll-area]");
    const backgroundThumb = page.locator("[data-app-page-scrollbar] .os-scrollbar-vertical .os-scrollbar-handle");
    expect(await backgroundThumb.evaluate(node => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit === node || node.contains(hit);
    })).toBe(false);
    const before = await backgroundViewport.evaluate(node => node.scrollTop);
    await page.mouse.move(5, 5);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => backgroundViewport.evaluate(node => node.scrollTop)).toBe(before);
    await dialog.getByRole("button", { name: "继续", exact: true }).click();
    const rotation = dialog.getByRole("combobox", { name: "换班方式" });
    await rotation.click();
    const list = page.locator('[data-slot="combobox-list"]:visible');
    await expect(list).toHaveAttribute("data-overlayscrollbars-viewport", /scrollbarHidden/);
    // Force overflow without altering the option structure.
    await list.evaluate(node => { node.style.maxHeight = "48px"; });
    await rotation.press("End");
    const highlighted = list.locator("[data-highlighted]");
    await expect(highlighted).toBeInViewport();
    await rotation.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(rotation).toBeFocused();
    await dialog.getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-slot="dialog-content"] .os-scrollbar')).toHaveCount(0);
  }
  await page.locator('[data-plan-primary-details-trigger]').click();
  const drawer = page.locator('[data-slot="drawer-body"]');
  await expect(drawer).toHaveAttribute("data-overlayscrollbars-viewport", /scrollbarHidden/);
  const details = drawer.locator("[data-plan-details-section]");
  await expect(details).toHaveAttribute("data-overlayscrollbars-viewport", /scrollbarHidden/);
  const backgroundViewport = page.locator("[data-app-scroll-area]");
  const before = await backgroundViewport.evaluate(node => node.scrollTop);
  await page.mouse.move(5, 5);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => backgroundViewport.evaluate(node => node.scrollTop)).toBe(before);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  // Wheel over the page viewport after the modal releases its scroll lock.
  await page.mouse.move(550, 300);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => backgroundViewport.evaluate(node => node.scrollTop)).toBeGreaterThan(before);
});

test("a failed scrollbar chunk leaves native scrolling available", async ({ page }) => {
  let blocked = 0;
  await page.route(/\/(?:assets\/[^/]*overlayscrollbars[^/]*\.js|node_modules\/\.vite\/(?:[^/]+\/)?deps\/overlayscrollbars\.js)(?:\?.*)?$/, route => {
    blocked++;
    return route.abort();
  });
  await page.goto("/help/import-operators");
  await expect.poll(() => blocked).toBeGreaterThan(0);
  await expect(page.locator(".os-scrollbar")).toHaveCount(0);
  const scroll = page.locator('[data-app-scroll-area="docs"]');
  await page.setViewportSize({ width: 390, height: 844 });
  await scroll.evaluate(node => { node.scrollTop = 600; });
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator("[data-overlayscrollbars-initialize]")).toHaveCount(0);
});

test("yeye scrollbars drag each axis, hide after leaving, and keep native scroll events", async ({ page }) => {
  await addSurfaces(page);
  for (const [direction, axes] of [["y", ["y"]], ["x", ["x"]], ["both", ["x", "y"]]] as const) {
    const viewport = page.locator("#scroll-" + direction);
    await expect(viewport.locator(":scope > .os-scrollbar")).toHaveCount(2);
    await viewport.evaluate(node => {
      node.addEventListener("scroll", () => node.setAttribute("data-did-scroll", "true"), { once: true });
    });
    for (const axis of axes) await drag(page, viewport, axis);
    await expect(viewport).toHaveAttribute("data-did-scroll", "true");
    const scrollbar = viewport.locator(direction === "x" ? ":scope > .os-scrollbar-horizontal" : ":scope > .os-scrollbar-vertical");
    await expect(scrollbar).toHaveCSS("--os-size", "8px");
    await expect(scrollbar).toHaveCSS("--os-handle-perpendicular-size", "4px");
    await expect(scrollbar).toHaveCSS("--os-handle-min-size", "36px");
    await page.mouse.move(5, 5);
    await expect(scrollbar).toHaveCSS("opacity", "0");
    await viewport.hover();
    await expect(scrollbar).toHaveCSS("opacity", "1");
  }
});

test("track clicks do not jump, resizing updates handles, and removed surfaces are destroyed", async ({ page }) => {
  await addSurfaces(page);
  const viewport = page.locator("#scroll-y");
  const scrollbar = viewport.locator(":scope > .os-scrollbar-vertical");
  const handle = scrollbar.locator(".os-scrollbar-handle");
  await viewport.hover();
  await expect(handle).toBeVisible();
  const trackBox = await scrollbar.boundingBox();
  await page.mouse.click(trackBox!.x + trackBox!.width / 2, trackBox!.y + trackBox!.height - 8);
  expect(await viewport.evaluate(node => node.scrollTop)).toBe(0);
  const initial = (await handle.boundingBox())!.height;
  await viewport.evaluate(node => { (node.firstElementChild as HTMLElement).style.height = "200px"; });
  await expect.poll(async () => (await handle.boundingBox())!.height).toBeGreaterThan(initial);
  await viewport.evaluate(node => { (node.firstElementChild as HTMLElement).style.height = "50px"; });
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/);
  // Changing an enrolled surface must not append another pair of scrollbars.
  await viewport.evaluate(node => node.classList.add("rounded-lg"));
  await expect(viewport.locator(":scope > .os-scrollbar")).toHaveCount(2);
  const removed = await viewport.elementHandle();
  await viewport.evaluate(node => node.remove());
  await expect.poll(() => removed!.evaluate(node => node.querySelectorAll(".os-scrollbar").length)).toBe(0);
});

test("dark and reduced-motion surfaces preserve dimensions and native textarea editing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await addSurfaces(page);
  await page.locator("html").evaluate(node => node.classList.add("dark"));
  const viewport = page.locator("#scroll-both");
  await drag(page, viewport, "y");
  await expect(viewport.locator(":scope > .os-scrollbar-vertical")).toHaveCSS("transition-duration", "0s");
  await page.evaluate(() => {
    const textarea = document.createElement("textarea");
    textarea.setAttribute("aria-label", "Native editor");
    textarea.style.height = "40px";
    document.querySelector("#scroll-fixture")!.append(textarea);
  });
  const editor = page.getByRole("textbox", { name: "Native editor" });
  await editor.fill(Array(30).fill("editable").join("\n"));
  await editor.press("ArrowUp");
  await editor.press("ArrowDown");
  await expect.poll(() => editor.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect(editor).not.toHaveAttribute("data-overlayscrollbars");
});

for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }]) {
  test.describe("touch " + viewport.width, () => {
    test.use({ hasTouch: true, viewport });
    test("keeps native local viewports and the external page scrollbar", async ({ page }) => {
      await addSurfaces(page);
      await expect(page.locator("#scroll-fixture .os-scrollbar")).toHaveCount(0);
      await expect(page.locator("[data-app-page-scrollbar] .os-scrollbar")).toHaveCount(2);
      for (const direction of ["y", "x", "both"]) {
        const surface = page.locator("#scroll-" + direction);
        await surface.evaluate(node => { node.scrollTop = 80; node.scrollLeft = 80; });
        expect(await surface.evaluate((node, direction) => direction === "x" ? node.scrollLeft : node.scrollTop, direction)).toBe(80);
        await expect(surface).toHaveCSS("touch-action", "auto");
      }
      await page.locator("#scroll-fixture").evaluate(node => node.remove());
      await page.goto("/help/import-operators");
      await expect(page.locator("body")).toHaveAttribute("data-app-hydrated", "true");
      const scroll = page.locator('[data-app-scroll-area="docs"]');
      await scroll.evaluate(node => { node.scrollTop = 500; });
      await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  });
}
