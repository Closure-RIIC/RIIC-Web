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
import { mockApis } from "./production-readiness.fixture";

async function expectReadableEfficiencies(poster: Locator) {
  await expect(poster.locator(".poster-production").first()).toBeVisible();
  const overlaps = await poster.locator(".poster-production [data-poster-shift]").evaluateAll(shifts => {
    const failures: string[] = [];
    for (const shift of shifts) {
      const label = `${shift.closest("[data-poster-room]")!.getAttribute("data-poster-room")}/${shift.getAttribute("data-poster-shift")}`;
      const bounds = shift.getBoundingClientRect();
      const panel = shift.querySelector<HTMLElement>(".poster-efficiency-panel")!;
      const efficiency = panel.getBoundingClientRect();
      // Check the actual cards, not only their flex container: shrinking that
      // container used to let the fixed-size portraits cover the efficiency.
      for (const card of shift.querySelectorAll(".poster-member, .poster-operator-art")) {
        const rect = card.getBoundingClientRect();
        if (rect.right > efficiency.left + .5) failures.push(`${label}: portrait overlaps efficiency`);
        if (rect.top < bounds.top - .5 || rect.bottom > bounds.bottom + .5) failures.push(`${label}: portrait clipped vertically`);
      }
      if (panel.scrollWidth > panel.clientWidth + 1) failures.push(`${label}: efficiency panel overflows`);
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        const rect = range.getBoundingClientRect();
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
}

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
    await expect(poster.locator('.poster-output[data-production-ready="true"]')).toBeAttached({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await expectReadableEfficiencies(poster);

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
      await expectReadableEfficiencies(poster);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(poster).toHaveAttribute("data-shift-count", "1");
    await expectReadableEfficiencies(poster);
  });
}
