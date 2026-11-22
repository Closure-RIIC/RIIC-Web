import { readFile } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import type { BaseBlueprint } from "@riic/arknights-domain/types";
import layout153 from "@riic/arknights-domain/layouts/153.json" with { type: "json" };
import layout243 from "@riic/arknights-domain/layouts/243.json" with { type: "json" };
import layout252 from "@riic/arknights-domain/layouts/252.json" with { type: "json" };
import layout333 from "@riic/arknights-domain/layouts/333.json" with { type: "json" };
import layout342 from "@riic/arknights-domain/layouts/342.json" with { type: "json" };
import { createManualScheduleDraft, manualRoomCapacity } from "../apps/arknights/src/manual-schedule";
import { createPosterDocument } from "../apps/arknights/src/schedule-poster-document";
import sampleTeams from "../apps/arknights/src/schedule-poster-sample.json" with { type: "json" };
import fullBox from "../fixtures/operbox_full_e2.json" with { type: "json" };
import { mockApis } from "./production-readiness.fixture";

async function expectReadableHeader(poster: Locator) {
  await expect(poster.locator(".poster-header")).toBeVisible();
  const failures = await poster.locator(".poster-header").evaluate(header => {
    const failures: string[] = [];
    const scale = header.closest("[data-schedule-poster]")!.getBoundingClientRect().width / 1920;
    const tolerance = scale * .75;
    const context = document.createElement("canvas").getContext("2d")!;
    const within = (a: DOMRect, b: DOMRect) => a.left >= b.left - tolerance && a.right <= b.right + tolerance &&
      a.top >= b.top - tolerance && a.bottom <= b.bottom + tolerance;
    const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right - tolerance && a.right > b.left + tolerance &&
      a.top < b.bottom - tolerance && a.bottom > b.top + tolerance;
    const bounds = header.getBoundingClientRect();
    const panels = [...header.children];
    for (const [index, panel] of panels.entries()) {
      const rect = panel.getBoundingClientRect();
      if (!within(rect, bounds)) failures.push(`${panel.className}: outside header`);
      if (panels.slice(index + 1).some(other => intersects(rect, other.getBoundingClientRect()))) {
        failures.push(`${panel.className}: overlapping header panels`);
      }
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      const content: DOMRect[] = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        const style = getComputedStyle(walker.currentNode.parentElement!);
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = context.measureText(walker.currentNode.textContent!);
        for (const line of range.getClientRects()) {
          // Range includes the font's blank ascender/descender space. Compare
          // painted glyphs so compact, separate text lines are checked accurately.
          const baseline = line.top + metrics.fontBoundingBoxAscent * scale;
          const text = new DOMRect(line.left, baseline - metrics.actualBoundingBoxAscent * scale,
            line.width, (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) * scale);
          const item = walker.currentNode.parentElement!.closest(".poster-output-values>div");
          if (!within(text, rect) || (item && !within(text, item.getBoundingClientRect()))) {
            failures.push(`${panel.className}: clipped text ${walker.currentNode.textContent}`);
          }
          if (content.some(previous => intersects(text, previous))) failures.push(`${panel.className}: overlapping text`);
          content.push(text);
        }
      }
      for (const image of panel.querySelectorAll("img,svg")) {
        const imageRect = image.getBoundingClientRect();
        if (!within(imageRect, rect) || content.some(text => intersects(imageRect, text))) {
          failures.push(`${panel.className}: clipped or overlapping image`);
        }
      }
    }
    const instructions = header.querySelector(".poster-instructions");
    const output = header.querySelector(".poster-output")!.getBoundingClientRect();
    if (instructions) {
      const notes = instructions.getBoundingClientRect();
      if (Math.min(notes.bottom, output.bottom) <= Math.max(notes.top, output.top) || notes.right > output.left + tolerance) {
        failures.push("instructions must precede production summary in the same row");
      }
    }
    return failures;
  });
  expect(failures).toEqual([]);
}

async function expectReadableEfficiencies(poster: Locator) {
  await expect(poster.locator(".poster-production").first()).toBeVisible();
  const overlaps = await poster.locator(".poster-production [data-poster-shift]").evaluateAll(shifts => {
    const failures: string[] = [];
    const context = document.createElement("canvas").getContext("2d")!;
    for (const shift of shifts) {
      const scale = shift.closest("[data-schedule-poster]")!.getBoundingClientRect().width / 1920;
      const label = `${shift.closest("[data-poster-room]")!.getAttribute("data-poster-room")}/${shift.getAttribute("data-poster-shift")}`;
      const bounds = shift.getBoundingClientRect();
      const panel = shift.querySelector<HTMLElement>(".poster-efficiency-panel")!;
      const efficiency = panel.getBoundingClientRect();
      // Check the actual cards, not only their flex container: shrinking that
      // container used to let the fixed-size portraits cover the efficiency.
      for (const card of shift.querySelectorAll(".poster-member, .poster-operator-art")) {
        const rect = card.getBoundingClientRect();
        if (rect.left < efficiency.right - .5 && rect.right > efficiency.left + .5 &&
            rect.top < efficiency.bottom - .5 && rect.bottom > efficiency.top + .5) {
          failures.push(`${label}: portrait overlaps efficiency`);
        }
        if (rect.top < bounds.top - .5 || rect.bottom > bounds.bottom + .5) failures.push(`${label}: portrait clipped vertically`);
      }
      if (panel.scrollWidth > panel.clientWidth + 1) failures.push(`${label}: efficiency panel overflows`);
      if (shift.closest("[data-schedule-poster]")!.getAttribute("data-shift-count") === "2") {
        const centerY = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return (rect.top + rect.bottom) / 2;
        };
        const aligned = (left: Element, right: Element) => Math.abs(centerY(left) - centerY(right)) <= scale * .75;
        const paperLabel = panel.querySelector(".poster-paper-efficiency>i")!;
        const paperValue = panel.querySelector(".poster-paper-efficiency>span")!;
        if (!aligned(paperLabel, paperValue)) failures.push(`${label}: paper label and value centers differ`);
        const equivalent = panel.querySelector(".poster-equivalent-efficiency");
        if (equivalent) {
          const firstValue = equivalent.querySelector(".poster-equivalent-values>span")!;
          if (!aligned(equivalent.querySelector("i")!, firstValue)) failures.push(`${label}: equivalent label is not centered on its first value`);
          if (!aligned(paperValue, firstValue)) failures.push(`${label}: paper and equivalent first values are on different rows`);
        }
      }
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        const line = range.getBoundingClientRect();
        const style = getComputedStyle(walker.currentNode.parentElement!);
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = context.measureText(walker.currentNode.textContent!);
        const baseline = line.top + metrics.fontBoundingBoxAscent * scale;
        const rect = new DOMRect(line.left, baseline - metrics.actualBoundingBoxAscent * scale,
          line.width, (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) * scale);
        if (rect.left < efficiency.left - .5 || rect.right > efficiency.right + .5 ||
            rect.top < bounds.top - .5 || rect.bottom > bounds.bottom + .5) {
          failures.push(`${label}: clipped efficiency text ${walker.currentNode.textContent}`);
        }
      }
    }
    return failures;
  });
  expect(overlaps).toEqual([]);
  const alignments = await poster.locator(".poster-production-row").evaluateAll(rows => rows.map(row => {
    const tops = new Map<string, number[]>();
    for (const shift of row.querySelectorAll("[data-poster-shift]")) {
      const index = shift.getAttribute("data-poster-shift")!;
      const top = shift.querySelector(".poster-paper-efficiency")!.getBoundingClientRect().top;
      tops.set(index, [...(tops.get(index) ?? []), top]);
    }
    return [...tops.values()].map(values => Math.max(...values) - Math.min(...values));
  }));
  expect(alignments.flat().every(difference => difference <= .5)).toBe(true);
  if (["3", "4"].includes(await poster.getAttribute("data-shift-count") ?? "")) {
    const sizes = await poster.locator('[data-poster-room-kind="factory"] .poster-paper-efficiency>span').evaluateAll(values =>
      values.map(value => parseFloat(getComputedStyle(value).fontSize)));
    expect(sizes.every(size => size >= 18)).toBe(true);
  }
}

async function expectReadableMembers(poster: Locator) {
  const geometry = await poster.evaluate(root => {
    const scale = root.getBoundingClientRect().width / 1920;
    const tolerance = scale * .75;
    const failures: string[] = [];
    const widths: Record<string, number[]> = {};
    const context = document.createElement("canvas").getContext("2d")!;
    const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right - tolerance && a.right > b.left + tolerance &&
      a.top < b.bottom - tolerance && a.bottom > b.top + tolerance;
    for (const shift of root.querySelectorAll<HTMLElement>("[data-poster-shift]")) {
      const room = shift.closest<HTMLElement>("[data-poster-room]")!;
      const label = `${room.dataset.posterRoom}/${shift.dataset.posterShift}`;
      const bounds = shift.getBoundingClientRect();
      const cards = [...shift.querySelectorAll<HTMLElement>(".poster-member")];
      const texts: DOMRect[] = [];
      const walker = document.createTreeWalker(shift, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim() || walker.currentNode.parentElement?.closest(".poster-member")) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        const style = getComputedStyle(walker.currentNode.parentElement!);
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = context.measureText(walker.currentNode.textContent!);
        for (const line of range.getClientRects()) {
          const baseline = line.top + metrics.fontBoundingBoxAscent * scale;
          const rect = new DOMRect(line.left, baseline - metrics.actualBoundingBoxAscent * scale,
            line.width, (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) * scale);
          if (rect.left < bounds.left - tolerance || rect.right > bounds.right + tolerance ||
              rect.top < bounds.top - tolerance || rect.bottom > bounds.bottom + tolerance) {
            failures.push(`${label}: text outside shift ${walker.currentNode.textContent}`);
          }
          if (texts.some(previous => intersects(rect, previous))) failures.push(`${label}: overlapping text`);
          texts.push(rect);
        }
      }
      for (const [index, card] of cards.entries()) {
        const rect = card.getBoundingClientRect();
        const name = card.querySelector<HTMLElement>(".infra-operator-slot>span");
        if (name) {
          const style = getComputedStyle(name);
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const metrics = context.measureText(name.textContent ?? "");
          if (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > name.clientHeight + .1) {
            failures.push(`${label}: clipped name glyphs ${name.textContent}`);
          }
        }
        if (rect.left < bounds.left - tolerance || rect.right > bounds.right + tolerance ||
            rect.top < bounds.top - tolerance || rect.bottom > bounds.bottom + tolerance) {
          failures.push(`${label}: clipped card ${index}`);
        }
        if (cards.slice(index + 1).some(other => intersects(rect, other.getBoundingClientRect())) ||
            texts.some(text => intersects(rect, text))) failures.push(`${label}: overlapping card ${index}`);
        const kind = ["control", "production", "single", "pair", "dorm"].find(kind => room.classList.contains(`poster-${kind}`))!;
        (widths[kind] ??= []).push(rect.width / scale);
      }
    }
    return { failures, widths, count: root.getAttribute("data-shift-count") };
  });
  expect(geometry.failures).toEqual([]);
  const minimum = geometry.count === "2" ? 72 : geometry.count === "4" ? 46 : 61;
  expect(Object.values(geometry.widths).flat().every(width => width >= minimum - .1)).toBe(true);
}

async function expectReadableSupportNotes(poster: Locator) {
  await expectReadableHeader(poster);
  const failures = await poster.locator(".poster-support-notes>div").evaluateAll(columns => {
    const failures: string[] = [];
    for (const [index, column] of columns.entries()) {
      const bounds = column.getBoundingClientRect();
      const notes = column.parentElement!.getBoundingClientRect();
      const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT);
      const rects: DOMRect[] = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) {
          if (rect.left < bounds.left - .5 || rect.right > bounds.right + .5 ||
              rect.top < notes.top - .5 || rect.bottom > notes.bottom + .5) {
            failures.push(`${index}: overflowing support text ${walker.currentNode.textContent}`);
          }
          if (rects.some(previous => rect.left < previous.right - .5 && rect.right > previous.left + .5 &&
            rect.top < previous.bottom - .5 && rect.bottom > previous.top + .5)) {
            failures.push(`${index}: overlapping support text ${walker.currentNode.textContent}`);
          }
          rects.push(rect);
        }
      }
      for (const image of column.querySelectorAll("img")) {
        const rect = image.getBoundingClientRect();
        if (rect.right > bounds.right + .5 || rect.bottom > notes.bottom + .5 ||
            rects.some(text => rect.left < text.right - .5 && rect.right > text.left + .5 &&
              rect.top < text.bottom - .5 && rect.bottom > text.top + .5)) {
          failures.push(`${index}: overlapping support portrait`);
        }
      }
    }
    return failures;
  });
  expect(failures).toEqual([]);
}

for (const mode of ["native", "manual"] as const) {
  test(`${mode} two-shift poster shows only meaningful trade equivalents with aligned labels`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await mockApis(page);
    const layout = structuredClone(layout333) as BaseBlueprint;
    layout.rooms.find(room => room.id === "trade_3")!.product = { trade: { order: "gold" } };
    const draft = createManualScheduleDraft([12, 12]);
    const teams = [
      { trade_1: ["但书", "古米", "空爆"], trade_2: ["巫恋", "龙舌兰", "柏喙"], trade_3: ["芬", "香草", "玫兰莎"] },
      { trade_1: ["但书", "龙舌兰", "柏喙"], trade_2: ["巫恋", "古米", "空爆"], trade_3: ["芬", "香草", "玫兰莎"] },
    ];
    for (const [index, shift] of draft.shifts.entries()) {
      for (const [roomId, operators] of Object.entries(teams[index]!)) {
        shift.rooms[roomId] = { operators, manualSkillEfficiencyPct: 123.46 };
      }
    }
    const names = new Set(teams.flatMap(shift => Object.values(shift).flat()));
    const doc = createPosterDocument(layout, draft, fullBox.filter(operator => names.has(operator.name)));
    doc.efficiencyMode = mode;
    doc.meta.title = "两班贸易与赤金等效";
    await page.addInitScript(doc => {
      localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
      sessionStorage.setItem("riic.schedule-poster.handoff.v1.manual", JSON.stringify(doc));
    }, doc);
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto("/manual?tab=poster");
    const workbench = page.locator("[data-poster-workbench]");
    const poster = workbench.locator("[data-schedule-poster]");
    const efficiency = (roomId: string, shift: number) =>
      poster.locator(`[data-poster-room="${roomId}"] [data-poster-shift="${shift}"] .poster-efficiency-pair`);
    await expect(poster).toHaveAttribute("data-shift-count", "2", { timeout: 60_000 });
    await expect(poster.locator(".poster-output")).toHaveAttribute("data-production-ready", "false");
    await expect(poster.locator(".poster-equivalent-efficiency")).toHaveCount(0);
    if (mode === "manual") await expect(efficiency("trade_3", 0).locator(".poster-paper-efficiency>span")).toHaveText("123.46%");
    // Keep the shipped WASM calculation: these teams exercise distinct order rules.
    await workbench.getByRole("button", { name: "重新计算", exact: true }).click();
    await expect(poster.locator(".poster-output")).toHaveAttribute("data-production-ready", "true", { timeout: 30_000 });
    const proviso = efficiency("trade_1", 0);
    await expect(proviso.locator(".poster-equivalent-values>span")).toHaveText([/^\d+(?:\.\d+)?%贸易$/]);
    await expect(proviso).not.toHaveAttribute("title", /赤金等效/);
    for (const [roomId, shift] of [["trade_2", 0], ["trade_1", 1]] as const) {
      const values = efficiency(roomId, shift).locator(".poster-equivalent-values>span");
      await expect(values).toHaveText([/^\d+(?:\.\d+)?%贸易$/, /^\+\s*\d+(?:\.\d+)?%赤金$/]);
      expect(Number((await values.nth(1).innerText()).match(/\d+(?:\.\d+)?/)![0])).toBeGreaterThan(0);
    }
    for (const [roomId, shift] of [["trade_3", 0], ["trade_3", 1], ["trade_2", 1]] as const) {
      const regular = efficiency(roomId, shift);
      await expect(regular).toHaveAttribute("title", /订单倍率 1 =/);
      await expect(regular.locator(".poster-equivalent-efficiency")).toHaveCount(0);
      await expect(regular).not.toHaveAttribute("title", /等效效率|赤金等效/);
      if (mode === "manual") await expect(regular.locator(".poster-paper-efficiency>span")).toHaveText("123.5%");
    }
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 1200 });
      await expectReadableHeader(poster);
      await expectReadableEfficiencies(poster);
      await expectReadableMembers(poster);
    }
    if (mode === "native") {
      await page.setViewportSize({ width: 1600, height: 1200 });
      const download = page.waitForEvent("download");
      await workbench.getByRole("button", { name: "导出一页 PNG", exact: true }).click();
      const imagePath = testInfo.outputPath("333-2-shifts-trade-equivalents.png");
      await (await download).saveAs(imagePath);
      const image = await readFile(imagePath);
      expect(image.readUInt32BE(16)).toBe(1920);
      expect(image.readUInt32BE(20)).toBe(1080);
      await testInfo.attach("two-shift-trade-equivalents", { path: imagePath, contentType: "image/png" });
    }
  });
}

test("four-shift poster keeps cross-day timing and support targets clear in preview and PNG", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await mockApis(page);
  const draft = createManualScheduleDraft([6, 6, 6, 6]);
  draft.startTime = "23:00";
  draft.fiammettaEnabled = true;
  for (const [index, shift] of draft.shifts.entries()) {
    for (const room of layout243.rooms) {
      const members = (sampleTeams as Record<string, string[][]>)[room.id]?.[index % 3] ?? [];
      shift.rooms[room.id] = { operators: members.slice(0, manualRoomCapacity(room)) };
    }
    shift.droneTargetRoomId = layout243.rooms.find(room => room.kind === "factory")!.id;
    shift.fiammettaTarget = "维什戴尔";
  }
  const doc = createPosterDocument(layout243 as BaseBlueprint, draft);
  doc.efficiencyMode = "manual";
  await page.addInitScript(document => {
    localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
    sessionStorage.setItem("riic.schedule-poster.handoff.v1.manual", JSON.stringify(document));
  }, doc);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/manual?tab=poster");
  const workbench = page.locator("[data-poster-workbench]");
  const poster = workbench.locator("[data-schedule-poster]");
  await expect(poster).toHaveAttribute("data-shift-count", "4", { timeout: 60_000 });
  await workbench.getByRole("button", { name: "重新计算", exact: true }).click();
  await expect(poster.locator('.poster-output[data-production-ready="true"]')).toBeAttached({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await expect(poster.locator(".poster-support-notes")).toContainText("次日");
  await expect(poster.locator(".poster-fiammetta")).toHaveCount(4);
  await expectReadableSupportNotes(poster);
  await expectReadableEfficiencies(poster);
  await expectReadableMembers(poster);
  const download = page.waitForEvent("download");
  await workbench.getByRole("button", { name: "导出一页 PNG", exact: true }).click();
  const imagePath = testInfo.outputPath("243-4-shifts-cross-day.png");
  await (await download).saveAs(imagePath);
  const image = await readFile(imagePath);
  expect(image.readUInt32BE(16)).toBe(1920);
  expect(image.readUInt32BE(20)).toBe(1080);
  await testInfo.attach("four-shift-cross-day", { path: imagePath, contentType: "image/png" });
  const instructions = workbench.locator("label").filter({ hasText: "显示说明栏" }).getByRole("switch");
  await instructions.click();
  await expect(poster.locator(".poster-header-no-instructions")).toBeAttached();
  await expectReadableSupportNotes(poster);
  await expectReadableEfficiencies(poster);
  await expectReadableMembers(poster);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectReadableSupportNotes(poster);
  await expectReadableEfficiencies(poster);
  await expectReadableMembers(poster);
});

for (const layout of [layout153, layout243, layout252, layout333, layout342] as BaseBlueprint[]) {
  test(`${layout.template} poster keeps efficiency labels clear for one to four shifts and PNG export`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await mockApis(page);
    const draft = createManualScheduleDraft([8, 8, 8]);
    for (const [index, shift] of draft.shifts.entries()) {
      for (const room of layout.rooms) {
        const members = (sampleTeams as Record<string, string[][]>)[room.id]?.[index] ?? [];
        shift.rooms[room.id] = { operators: members.slice(0, manualRoomCapacity(room)) };
      }
    }
    const document = createPosterDocument(layout, draft);
    document.efficiencyMode = "manual";
    for (const shift of document.draft.shifts) {
      for (const assignment of Object.values(shift.rooms)) assignment.manualSkillEfficiencyPct = 1234.5;
    }
    await page.addInitScript(doc => {
      localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
      sessionStorage.setItem("riic.schedule-poster.handoff.v1.manual", JSON.stringify(doc));
    }, document);
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto("/manual?tab=poster");
    const workbench = page.locator("[data-poster-workbench]");
    const poster = workbench.locator("[data-schedule-poster]");
    await expect(poster).toHaveAttribute("data-shift-count", "3", { timeout: 60_000 });
    await workbench.getByRole("button", { name: "重新计算", exact: true }).click();
    await expect(poster.locator('.poster-output[data-production-ready="true"]')).toBeAttached({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(poster.locator(".poster-output-values>div")).toHaveCount(layout.template === "333" ? 4 : 3);
    await expectReadableHeader(poster);
    await expectReadableEfficiencies(poster);
    await expectReadableMembers(poster);

    const download = page.waitForEvent("download");
    await workbench.getByRole("button", { name: "导出一页 PNG", exact: true }).click();
    const exported = await download;
    const imagePath = testInfo.outputPath(`${layout.template}-3-shifts.png`);
    await exported.saveAs(imagePath);
    const image = await readFile(imagePath);
    expect(image.readUInt32BE(16)).toBe(1920);
    expect(image.readUInt32BE(20)).toBe(1080);
    await testInfo.attach(`${layout.template}-3-shifts.png`, { path: imagePath, contentType: "image/png" });

    for (const count of [4, 2, 1]) {
      await workbench.getByLabel("班次数", { exact: true }).click();
      await page.getByRole("option", { name: `${count} 班`, exact: true }).click();
      await expect(poster).toHaveAttribute("data-shift-count", String(count));
      await expect(page.locator("[data-manual-result-outdated]")).toBeVisible();
      await workbench.getByRole("button", { name: "重新计算", exact: true }).click();
      await expect(page.locator("[data-manual-result-outdated]")).toHaveCount(0);
      await expectReadableSupportNotes(poster);
      await expectReadableEfficiencies(poster);
      await expectReadableMembers(poster);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(poster).toHaveAttribute("data-shift-count", "1");
    await expectReadableSupportNotes(poster);
    await expectReadableEfficiencies(poster);
    await expectReadableMembers(poster);
  });
}

test("poster fits five products, single-column instructions and a generated QR code", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await mockApis(page);
  const layout = structuredClone(layout243) as BaseBlueprint;
  layout.rooms.find(room => room.id === "trade_2")!.product = { trade: { order: "originium" } };
  layout.rooms.find(room => room.id === "manu_2")!.product = { factory: { recipe: "originium" } };
  const draft = createManualScheduleDraft([6, 6, 6, 6]);
  const doc = createPosterDocument(layout, draft);
  doc.efficiencyMode = "manual";
  doc.meta.title = "四班长标题边界测试".repeat(5).slice(0, 40);
  doc.meta.author = "作者名称边界".repeat(7).slice(0, 40);
  doc.meta.instructions = "请按照班次顺序轮换，注意无人机与菲亚梅塔的目标设施。".repeat(12).slice(0, 240);
  for (const [index, shift] of doc.draft.shifts.entries()) {
    for (const room of layout.rooms) {
      const members = (sampleTeams as Record<string, string[][]>)[room.id]?.[index % 3] ?? [];
      shift.rooms[room.id] = { operators: members.slice(0, manualRoomCapacity(room)), manualSkillEfficiencyPct: 1234.5 };
    }
  }
  await page.route("**/api/schedule-posters", route => route.fulfill({ json: { code: "123456abcdef" } }));
  await page.addInitScript(document => {
    localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
    sessionStorage.setItem("riic.schedule-poster.handoff.v1.manual", JSON.stringify(document));
  }, doc);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/manual?tab=poster");
  const workbench = page.locator("[data-poster-workbench]");
  const poster = workbench.locator("[data-schedule-poster]");
  await expect(poster).toHaveAttribute("data-shift-count", "4", { timeout: 60_000 });
  await workbench.getByRole("button", { name: "重新计算", exact: true }).click();
  await expect(poster.locator(".poster-output-values>div")).toHaveCount(5, { timeout: 30_000 });
  await expect(poster.locator(".poster-output")).toContainText("源石碎片");
  await page.evaluate(() => document.fonts.ready);
  const instructionInput = workbench.locator("textarea").first();
  for (const text of [
    Array.from({ length: 6 }, (_, index) => `第${index + 1}项：轮换后检查对应设施。`).join("\n"),
    Array.from({ length: 6 }, (_, index) => `第${index + 1}项：${"按顺序轮换并核对目标设施".repeat(3)}`).join("\n").slice(0, 240),
    Array.from({ length: 120 }, () => "换").join("\n"),
    doc.meta.instructions,
  ]) {
    await instructionInput.fill(text);
    await expect(poster.locator(".poster-instructions>div")).toHaveText(text);
    await expect(poster.locator(".poster-instructions>div")).toHaveCSS("column-count", "auto");
    await expectReadableHeader(poster);
  }
  const instructions = workbench.locator("label").filter({ hasText: "显示说明栏" }).getByRole("switch");
  for (const show of [true, false]) {
    if (!show) await instructions.click();
    await workbench.getByRole("button", { name: "生成作业码", exact: true }).click();
    await expect(poster.locator(".poster-share svg")).toBeVisible();
    await expectReadableSupportNotes(poster);
    await expectReadableEfficiencies(poster);
    await expectReadableMembers(poster);
    const download = page.waitForEvent("download");
    await workbench.getByRole("button", { name: "导出一页 PNG", exact: true }).click();
    const imagePath = testInfo.outputPath(`five-products-${show ? "instructions" : "compact"}.png`);
    await (await download).saveAs(imagePath);
    await testInfo.attach(`five-products-${show}`, { path: imagePath, contentType: "image/png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectReadableSupportNotes(poster);
    await page.setViewportSize({ width: 1600, height: 1200 });
  }
  // Re-import actual production changes: zero outputs must release their space.
  for (const count of [4, 3]) {
    const fewerProducts = structuredClone(doc);
    fewerProducts.meta.title = `${count}种产物自适应`;
    fewerProducts.layout.rooms.find(room => room.id === "trade_2")!.product = { trade: { order: "gold" } };
    if (count === 3) fewerProducts.layout.rooms.find(room => room.id === "manu_2")!.product = { factory: { recipe: "gold" } };
    await workbench.locator("input[type=file]").first().setInputFiles({
      name: `products-${count}.riic.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fewerProducts)),
    });
    await expect(poster.locator("h1")).toHaveText(fewerProducts.meta.title);
    await workbench.getByRole("button", { name: "重新计算", exact: true }).click();
    const cards = poster.locator(".poster-output-values>div");
    await expect(cards).toHaveCount(count, { timeout: 30_000 });
    await expect(poster.locator(".poster-output")).not.toContainText("合成玉");
    if (count === 3) await expect(poster.locator(".poster-output")).not.toContainText("源石碎片");
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 1200 });
      await expectReadableHeader(poster);
      const placement = await cards.evaluateAll(elements => {
        const parent = elements[0]!.parentElement!;
        const bounds = parent.getBoundingClientRect();
        const rects = elements.map(element => element.getBoundingClientRect());
        return {
          equalWidths: rects.every(rect => Math.abs(rect.width - rects[0]!.width) < 1),
          fillsRow: Math.abs(rects[0]!.left - bounds.left) < 1 && Math.abs(rects.at(-1)!.right - bounds.right) < 1,
          oneRow: rects.every(rect => Math.abs(rect.top - rects[0]!.top) < 1),
        };
      });
      expect(placement).toEqual({ equalWidths: true, fillsRow: true, oneRow: true });
    }
    await page.setViewportSize({ width: 1600, height: 1200 });
  }
});
