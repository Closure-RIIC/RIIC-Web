import { expect, test, type Page } from "@playwright/test";
import layout243 from "@riic/arknights-domain/layouts/243.json" with { type: "json" };
import { createManualScheduleDraft } from "../apps/arknights/src/manual-schedule";
import { createPosterDocument, type SchedulePosterDocument } from "../apps/arknights/src/schedule-poster-document";
import { mockApis } from "./production-readiness.fixture";
import { sessionPayload, sessionStorageKey } from "./session";

const cacheKey = "arknights-infra-manual-evaluation-v1";
const workingCopyKey = "riic.schedule-poster.working-copy.v1";
const operators = [
  { id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 6, rarity: 5 },
  { id: "char_348_ceylon", name: "锡兰", elite: 2, level: 60, own: true, potential: 1, rarity: 5 },
];

function work(mode: "native" | "manual", product: "gold" | "battle_record") {
  const draft = createManualScheduleDraft([12, 12]);
  for (const shift of draft.shifts) {
    shift.rooms.trade_1 = { operators: ["阿米娅"], manualSkillEfficiencyPct: product === "gold" ? 123 : 47 };
    for (const room of layout243.rooms.filter(room => room.kind === "factory")) {
      shift.rooms[room.id] = {
        operators: room.id === "manu_1" ? ["锡兰"] : [],
        product: { factory: { recipe: product } },
        manualSkillEfficiencyPct: product === "gold" ? 123 : 47,
      };
    }
  }
  const document = createPosterDocument(layout243, draft, operators);
  document.meta.title = product === "gold" ? "个人赤金作业 A" : "经验作业 B";
  document.efficiencyMode = mode;
  return document;
}

async function seedPersonalWork(page: Page, document: SchedulePosterDocument) {
  const seededSession = sessionPayload({
    layout: document.layout, operbox: operators, sourceName: "产物失效回归",
  });
  await page.addInitScript(([key, payload, document]) => {
    localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify(payload));
    localStorage.setItem("arknights-infra-manual-schedule-v1", JSON.stringify(document.draft));
    localStorage.setItem("riic.schedule-poster.v1", JSON.stringify(document));
  }, [sessionStorageKey, seededSession, document] as const);
}

const workbench = (page: Page) => page.locator("[data-poster-workbench]");
const poster = (page: Page) => workbench(page).locator("[data-schedule-poster]");
const output = (page: Page) => poster(page).locator(".poster-output");
const cachedEvaluation = (page: Page) => page.evaluate(key => localStorage.getItem(key), cacheKey);

async function importWork(page: Page, document: SchedulePosterDocument) {
  await workbench(page).locator('input[type="file"][accept=".json"]').setInputFiles({
    name: "replacement.riic.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(workbench(page).getByLabel("作业名称", { exact: true })).toHaveValue(document.meta.title);
}

async function expectUncalculated(page: Page) {
  await expect(output(page)).toHaveAttribute("data-production-ready", "false");
  await expect(output(page).locator(".poster-output-values>div")).toHaveCount(0);
  const efficiency = poster(page).locator('[data-poster-room="trade_1"] .poster-efficiency-pair').first();
  await expect(efficiency).not.toHaveAttribute("title", /总效率 = 基础/);
  await expect(efficiency.locator(".poster-equivalent-efficiency")).toHaveCount(0);
  await expect(workbench(page).getByRole("button", { name: "重新计算", exact: true })).toBeEnabled();
  expect(await cachedEvaluation(page)).toBeNull();
}

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
});

for (const mode of ["native", "manual"] as const) {
  test(`${mode} results survive invalid imports and clear when another work with the same layout is imported`, async ({ page }) => {
    const first = work(mode, "gold");
    const replacement = work(mode, "battle_record");
    expect(replacement.layout).toEqual(first.layout);
    await seedPersonalWork(page, first);
    await page.goto("/manual?tab=poster");
    await expect(workbench(page).getByLabel("作业名称", { exact: true })).toHaveValue(first.meta.title);
    await workbench(page).getByRole("button", { name: "重新计算", exact: true }).click();
    await expect(output(page)).toHaveAttribute("data-production-ready", "true");
    await expect(output(page)).not.toContainText("经验");
    await expect.poll(() => cachedEvaluation(page)).not.toBeNull();
    const previousOutput = await output(page).innerText();
    const previousCache = await cachedEvaluation(page);

    await workbench(page).locator('input[type="file"][accept=".json"]').setInputFiles({
      name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{}"),
    });
    await expect(workbench(page).getByRole("alert")).toBeVisible();
    await expect(workbench(page).getByLabel("作业名称", { exact: true })).toHaveValue(first.meta.title);
    await expect(output(page)).toHaveAttribute("data-production-ready", "true");
    expect(await output(page).innerText()).toBe(previousOutput);
    expect(await cachedEvaluation(page)).toBe(previousCache);

    await importWork(page, replacement);
    await expectUncalculated(page);
    if (mode === "manual") {
      // A supplied paper efficiency belongs to B; only A's computed values must disappear.
      await expect(poster(page).locator('[data-poster-room="trade_1"] .poster-paper-efficiency').first()).toContainText("47%");
    }
    await workbench(page).getByRole("button", { name: "重新计算", exact: true }).click();
    await expect(output(page)).toHaveAttribute("data-production-ready", "true");
    await expect(output(page)).toContainText("经验");
    expect(await cachedEvaluation(page)).toBeNull();

    await page.reload();
    await expect(workbench(page).getByLabel("作业名称", { exact: true })).toHaveValue(replacement.meta.title);
    await expectUncalculated(page);
    await workbench(page).getByRole("button", { name: "重新计算", exact: true }).click();
    await expect(output(page)).toHaveAttribute("data-production-ready", "true");
    await expect(output(page)).toContainText("经验");
    await page.getByRole("button", { name: "返回个人草稿", exact: true }).click();
    await expect(page.getByRole("tab", { name: "作业图", exact: true })).toBeVisible();
    expect(await page.evaluate(key => sessionStorage.getItem(key), workingCopyKey)).toBeNull();
    await page.getByRole("tab", { name: "作业图", exact: true }).click();
    await expectUncalculated(page);
  });

  test(`${mode} discards a previous work's evaluation after its delayed WASM load completes`, async ({ page }) => {
    let manifestRequested = false;
    let releaseManifest!: () => void;
    const manifestGate = new Promise<void>(resolve => { releaseManifest = resolve; });
    await page.route("**/wasm/infra-eval-manifest.json", async route => {
      const response = await route.fetch();
      manifestRequested = true;
      await manifestGate;
      await route.fulfill({ response });
    });
    await page.route("**/wasm/infra_eval_wasm.js", async route => {
      const response = await route.fetch();
      const source = await response.text();
      const declaration = "export function evaluate_v1(request_json)";
      expect(source).toContain(declaration);
      // Delegate unchanged requests to the shipped WASM. A task after its return
      // observes the completed async chain, not merely the manifest response.
      const body = source.replace(declaration, "function observedEvaluate(request_json)") + `
export function evaluate_v1(request_json) {
  const result = observedEvaluate(request_json);
  setTimeout(() => { globalThis.__manualWasmCompleted = (globalThis.__manualWasmCompleted || 0) + 1; }, 0);
  return result;
}
`;
      await route.fulfill({ response, body });
    });
    await seedPersonalWork(page, work(mode, "gold"));
    try {
      await page.goto("/manual?tab=poster");
      await workbench(page).getByRole("button", { name: "重新计算", exact: true }).click();
      await expect.poll(() => manifestRequested).toBe(true);
      await expect(workbench(page).getByRole("button", { name: "正在计算…", exact: true })).toBeDisabled();
      await importWork(page, work(mode, "battle_record"));
      await expectUncalculated(page);
      await page.evaluate(() => {
        const state = window as typeof window & { __stalePosterOutputs?: string[] };
        state.__stalePosterOutputs = [];
        new MutationObserver(() => {
          const output = document.querySelector('[data-schedule-poster] .poster-output[data-production-ready="true"]');
          if (output) state.__stalePosterOutputs!.push(output.textContent ?? "");
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-production-ready"] });
      });
      releaseManifest();
      // Both product-changing shifts issue real synchronous WASM evaluations.
      await expect.poll(() => page.evaluate(() => (window as typeof window & { __manualWasmCompleted?: number }).__manualWasmCompleted ?? 0)).toBe(2);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await page.evaluate(() => (window as typeof window & { __stalePosterOutputs?: string[] }).__stalePosterOutputs)).toEqual([]);
      await expectUncalculated(page);

      await workbench(page).getByRole("button", { name: "重新计算", exact: true }).click();
      await expect(output(page)).toHaveAttribute("data-production-ready", "true");
      await expect(output(page)).toContainText("经验");
      expect(await cachedEvaluation(page)).toBeNull();
    } finally {
      releaseManifest();
    }
  });
}
