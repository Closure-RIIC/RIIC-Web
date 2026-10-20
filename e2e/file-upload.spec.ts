import { expect, test, type Locator, type Page } from "@playwright/test";
import { utils, write } from "xlsx";
import layout243 from "../apps/arknights/src/layouts/243.json" with { type: "json" };
import { mockApis, now, planData } from "./production-readiness.fixture";

const operators = [
  { id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 6, rarity: 5 },
];
const importedOperators = [
  { id: "char_348_ceylon", name: "锡兰", elite: 2, level: 60, own: true, potential: 1, rarity: 5 },
];
const importedSchedule = {
  title: "上传测试排班",
  plans: [{
    name: "白班",
    rooms: {
      trading: [{ product: "Originium Shard", operators: ["锡兰"] }],
      manufacture: [{ product: "Battle Record", operators: [] }],
    },
  }],
};
const uploadSelector = "[data-file-upload-dialog]";

function jsonFile(name: string, value: unknown) {
  return { name, mimeType: "", buffer: Buffer.from(JSON.stringify(value)) };
}

async function chooseFile(page: Page, upload: Locator, file: ReturnType<typeof jsonFile>, english = false) {
  const chooser = page.waitForEvent("filechooser");
  await upload.getByRole("button", { name: english ? "Choose files" : "选择文件", exact: true }).click();
  const fileChooser = await chooser;
  expect(fileChooser.isMultiple()).toBe(false);
  await fileChooser.setFiles(file);
}

async function workspaceData(page: Page) {
  return page.evaluate(() => {
    const session = JSON.parse(window.localStorage.getItem("arknights-infra-calc-session-v5") ?? "null");
    return {
      operbox: session?.operbox,
      sourceName: session?.sourceName,
      boxSource: session?.boxSource,
      layout: session?.layout,
      layoutDirty: session?.layoutDirty,
      layoutSource: session?.layoutSource,
      result: session?.result,
      manual: JSON.parse(window.localStorage.getItem("arknights-infra-manual-schedule-v1") ?? "null"),
    };
  });
}

async function openSetup(page: Page) {
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: /^配置\s*Box\s*与布局$/ }).first().click();
  const setup = page.locator("[data-setup-dialog]");
  await expect(setup.locator("[data-setup-box-content]")).toBeVisible();
  return setup;
}

async function openBoxUpload(page: Page) {
  const setup = await openSetup(page);
  await setup.getByRole("button", { name: "更换", exact: true }).click();
  await setup.getByRole("tab", { name: "MAA", exact: true }).click();
  const trigger = setup.getByRole("button", { name: "上传练度 JSON / XLSX", exact: true });
  await trigger.click();
  const upload = page.locator(uploadSelector);
  await expect(upload).toHaveAccessibleName("导入干员数据");
  return { setup, trigger, upload };
}

async function expectFocusWithin(dialog: Locator) {
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    json: {
      session: {
        id: "upload-test-session", token: "upload-test-token", userId: "upload-test-user",
        expiresAt: new Date(now + 3_600_000).toISOString(),
        createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
      },
      user: {
        id: "upload-test-user", name: "上传测试用户", email: "upload-test@example.com", emailVerified: true,
        createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
      },
    },
  }));
  await page.addInitScript(({ layout, operbox, result, savedAt, expiresAt }) => {
    window.localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
    window.localStorage.setItem("arknights-infra-calc-session-v5", JSON.stringify({
      version: 5, savedAt, expiresAt, presetLabel: "243", layout, operbox,
      sourceName: "上传前的测试 Box", boxSource: "sample", layoutDirty: false,
      layoutSource: "local", localLayoutBackup: null, rotationProfile: "abc_12_6_6",
      fiammettaEnabled: false, result, activeShift: 0,
    }));
    window.localStorage.setItem("arknights-infra-manual-schedule-v1", JSON.stringify({
      version: 2, activeShift: 0, fiammettaEnabled: false,
      shifts: [{ durationHours: 24, fiammettaTarget: null, rooms: { trade_1: { operators: ["阿米娅", null, null] } } }],
    }));
  }, {
    layout: layout243, operbox: operators, result: planData,
    savedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
});

test("Box first opens the upload dialog, then choosing uppercase JSON with no MIME imports automatically", async ({ page }) => {
  let chooserCount = 0;
  page.on("filechooser", () => { chooserCount += 1; });
  const { setup, upload } = await openBoxUpload(page);
  expect(chooserCount).toBe(0);
  await expect(upload).toContainText(/\.json/i);
  await expect(upload).toContainText(/\.xlsx/i);
  await expect(upload.getByRole("button", { name: "继续", exact: true })).toHaveCount(0);
  await expectFocusWithin(upload);

  await chooseFile(page, upload, jsonFile("operators.JSON", importedOperators));
  await expect(upload).toHaveCount(0);
  await expect(setup.locator("[data-setup-layout-basics]")).toBeVisible();
  await expectFocusWithin(setup.locator("[data-setup-layout-basics]"));
  await expect.poll(async () => {
    const { operbox, sourceName, boxSource, result } = await workspaceData(page);
    return { operbox, sourceName, boxSource, result };
  }).toEqual({ operbox: importedOperators, sourceName: "operators.JSON", boxSource: "maa", result: null });
  expect(chooserCount).toBe(1);
});

for (const extension of ["xlsx", "xls"] as const) {
  test(`Box accepts a real ${extension.toUpperCase()} workbook dropped onto the upload area`, async ({ page }) => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.json_to_sheet(importedOperators), "Operators");
    const { setup, upload } = await openBoxUpload(page);
    await upload.locator("[data-file-dropzone]").drop({ files: {
      name: `operators.${extension.toUpperCase()}`, mimeType: "",
      buffer: Buffer.from(write(workbook, { type: "buffer", bookType: extension })),
    } });
    await expect(upload).toHaveCount(0);
    await expect(setup.locator("[data-setup-layout-basics]")).toBeVisible();
    await expect.poll(async () => (await workspaceData(page)).operbox).toEqual(importedOperators);
    await expect.poll(async () => (await workspaceData(page)).result).toBeNull();
  });
}

test("Box rejects multiple files, unsupported extensions and invalid data, and retries the same filename", async ({ page }) => {
  const { setup, upload } = await openBoxUpload(page);
  const before = await workspaceData(page);
  const dropzone = upload.locator("[data-file-dropzone]");
  await dropzone.drop({ files: [jsonFile("first.json", importedOperators), jsonFile("second.json", operators)] });
  await expect(upload.getByRole("alert")).toContainText("每次只能导入一个文件");
  expect(await workspaceData(page)).toEqual(before);

  await dropzone.drop({ files: jsonFile("operators.txt", importedOperators) });
  await expect(upload.getByRole("alert")).toContainText("不支持文件");
  expect(await workspaceData(page)).toEqual(before);

  await chooseFile(page, upload, jsonFile("retry.json", { operators: importedOperators }));
  await expect(upload.getByRole("alert")).toContainText("非空数组");
  await expect(upload.getByRole("button", { name: "选择文件", exact: true })).toBeEnabled();
  expect(await workspaceData(page)).toEqual(before);
  await expect(setup.locator("[data-setup-box-content]")).toBeVisible();

  await chooseFile(page, upload, jsonFile("retry.json", importedOperators));
  await expect(upload).toHaveCount(0);
  await expect.poll(async () => (await workspaceData(page)).operbox).toEqual(importedOperators);
});

test("file drag highlighting survives child transitions, ignores text and protects drops outside the upload dialog", async ({ page }) => {
  const { setup, upload } = await openBoxUpload(page);
  const before = await workspaceData(page);
  const initialUrl = page.url();
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  const dropzone = upload.locator("[data-file-dropzone]");
  const chooseButton = upload.getByRole("button", { name: "选择文件", exact: true });
  const fileTransfer = await page.evaluateHandle((contents) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([contents], "outside.json", { type: "application/json" }));
    return transfer;
  }, JSON.stringify(importedOperators));

  await dropzone.dispatchEvent("dragenter", { dataTransfer: fileTransfer });
  await expect(dropzone).toHaveAttribute("data-dragging", "true");
  await expect(upload.getByRole("status")).toHaveText("松开以选择文件");
  // Moving onto a child enters the child before leaving the previous target.
  await chooseButton.dispatchEvent("dragenter", { dataTransfer: fileTransfer });
  await dropzone.dispatchEvent("dragleave", { dataTransfer: fileTransfer });
  await expect(dropzone).toHaveAttribute("data-dragging", "true");
  await expect(upload.getByRole("status")).toHaveText("松开以选择文件");
  await chooseButton.dispatchEvent("dragleave", { dataTransfer: fileTransfer });
  await expect(dropzone).not.toHaveAttribute("data-dragging");
  await expect(upload.getByRole("status")).toHaveText("拖拽文件到此处，或点击选择");
  await dropzone.dispatchEvent("dragenter", { dataTransfer: fileTransfer });
  await expect(dropzone).toHaveAttribute("data-dragging", "true");
  await dropzone.dispatchEvent("dragleave", { dataTransfer: fileTransfer });
  await expect(dropzone).not.toHaveAttribute("data-dragging");

  const textTransfer = await page.evaluateHandle((contents) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", contents);
    return transfer;
  }, JSON.stringify(importedOperators));
  for (const eventType of ["dragenter", "dragover", "drop"]) {
    await dropzone.dispatchEvent(eventType, { dataTransfer: textTransfer });
  }
  await expect(dropzone).not.toHaveAttribute("data-dragging");
  await expect(dropzone).toHaveAttribute("aria-busy", "false");
  await expect(upload.getByRole("alert")).toHaveCount(0);
  expect(await workspaceData(page)).toEqual(before);

  const overlay = page.locator('[data-slot="dialog-overlay"]');
  await expect(overlay).toBeVisible();
  // Synthetic native events cannot trigger browser navigation by themselves;
  // assert preventDefault as well as the page and data remaining unchanged.
  const prevented = await overlay.evaluate((element, dataTransfer) => {
    return ["dragover", "drop"].map((type) => {
      const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
  }, fileTransfer);
  expect(prevented).toEqual([true, true]);
  await expect(upload).toBeVisible();
  await expect(dropzone).toHaveAttribute("aria-busy", "false");
  expect(await workspaceData(page)).toEqual(before);
  expect(page.url()).toBe(initialUrl);
  expect(navigations).toEqual([]);

  await upload.getByRole("button", { name: "取消", exact: true }).click();
  await expect(upload).toHaveCount(0);
  await setup.getByRole("button", { name: "Close", exact: true }).click();
  await expect(setup).toHaveCount(0);
  for (const eventType of ["dragenter", "dragover", "drop"]) {
    await page.locator("body").dispatchEvent(eventType, { dataTransfer: fileTransfer });
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(upload).toHaveCount(0);
  await expect(setup).toHaveCount(0);
  expect(await workspaceData(page)).toEqual(before);
  expect(navigations).toEqual([]);
  await textTransfer.dispose();
  await fileTransfer.dispose();
});

test("abnormal Box progression goes to the existing review and applies only after confirmation", async ({ page }) => {
  const { setup, upload, trigger } = await openBoxUpload(page);
  const before = await workspaceData(page);
  const invalidProgression = jsonFile("review.json", [{ ...importedOperators[0], level: 99 }]);
  await upload.locator("[data-file-dropzone]").drop({ files: invalidProgression });
  const review = setup.getByRole("region", { name: "导入异常确认" });
  await expect(upload).toHaveCount(0);
  await expect(review).toBeVisible();
  await expectFocusWithin(review);
  await expect(review).toContainText("发现 1 项异常练度");
  await expect(review.getByRole("button", { name: "确认选择并导入" })).toBeDisabled();
  expect(await workspaceData(page)).toEqual(before);
  await review.getByRole("button", { name: "取消本次导入" }).click();
  await expect(review).toHaveCount(0);
  expect(await workspaceData(page)).toEqual(before);

  await trigger.click();
  await chooseFile(page, upload, invalidProgression);
  await expect(review).toBeVisible();
  await review.getByRole("group", { name: "锡兰的修正方案" }).getByRole("button", { name: "精2", exact: true }).click();
  await review.getByRole("button", { name: "确认选择并导入" }).click();
  await expect(setup.locator("[data-setup-layout-basics]")).toBeVisible();
  await expect.poll(async () => (await workspaceData(page)).operbox).toEqual([{ ...importedOperators[0], level: 1 }]);
});

test("Escape cancels an in-flight Box read and its late result cannot overwrite a reopened upload", async ({ page }) => {
  const { setup, trigger, upload } = await openBoxUpload(page);
  const before = await workspaceData(page);
  await page.evaluate(() => {
    const originalText = File.prototype.text;
    File.prototype.text = async function () {
      if (this.name !== "late-review.json") return originalText.call(this);
      document.documentElement.setAttribute("data-upload-read-started", "true");
      await new Promise<void>((resolve) => window.addEventListener("release-upload-read", () => resolve(), { once: true }));
      const value = await originalText.call(this);
      document.documentElement.setAttribute("data-upload-read-finished", "true");
      return value;
    };
  });
  await chooseFile(page, upload, jsonFile("late-review.json", [{ ...operators[0], level: 99 }]));
  await expect(page.locator("html")).toHaveAttribute("data-upload-read-started", "true");
  await expect(upload.getByRole("button", { name: "选择文件", exact: true })).toBeDisabled();
  await expect(upload.getByRole("status")).toContainText("正在读取");
  await page.keyboard.press("Escape");
  await expect(upload).toHaveCount(0);
  await expect(setup.locator("[data-setup-box-content]")).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await workspaceData(page)).toEqual(before);

  await trigger.click();
  await chooseFile(page, upload, jsonFile("current.json", importedOperators));
  await expect(upload).toHaveCount(0);
  await expect(setup.locator("[data-setup-layout-basics]")).toBeVisible();
  await expect.poll(async () => (await workspaceData(page)).sourceName).toBe("current.json");
  const current = await workspaceData(page);
  await page.evaluate(() => window.dispatchEvent(new Event("release-upload-read")));
  await expect(page.locator("html")).toHaveAttribute("data-upload-read-finished", "true");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await workspaceData(page)).toEqual(current);
  await expect(setup.getByRole("region", { name: "导入异常确认" })).toHaveCount(0);
  await expect(setup.locator("[data-setup-layout-basics]")).toBeVisible();
});

test("layout upload preserves the parent step and focus on errors and cancellation, then imports a dropped JSON", async ({ page }) => {
  const setup = await openSetup(page);
  await setup.getByRole("button", { name: "继续", exact: true }).click();
  await setup.getByText("高级工具", { exact: true }).click();
  const trigger = setup.getByRole("button", { name: "导入布局", exact: true });
  const before = await workspaceData(page);
  await trigger.click();
  const upload = page.locator(uploadSelector);
  await expect(upload).toHaveAccessibleName("导入布局");
  await expectFocusWithin(upload);
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press("Tab");
    await expectFocusWithin(upload);
  }
  await chooseFile(page, upload, jsonFile("layout.json", { template: "broken", rooms: [] }));
  await expect(upload.getByRole("alert")).toContainText("布局文件格式无效");
  expect(await workspaceData(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(upload).toHaveCount(0);
  await expect(setup.locator("[data-setup-layout-basics]")).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await workspaceData(page)).toEqual(before);

  await trigger.click();
  await upload.getByRole("button", { name: "取消", exact: true }).click();
  await expect(upload).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  const importedLayout = { ...layout243, drone_cap: 200 };
  await upload.locator("[data-file-dropzone]").drop({ files: jsonFile("layout.JSON", importedLayout) });
  await expect(upload).toHaveCount(0);
  await expect(setup.locator("[data-setup-layout-basics]")).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect.poll(async () => {
    const { layout, layoutDirty, result } = await workspaceData(page);
    return { layout, layoutDirty, result };
  }).toEqual({ layout: importedLayout, layoutDirty: true, result: null });
  await expect(setup.getByRole("button", { name: "检查设施", exact: true })).toBeVisible();
});

test("manual upload enforces the 5 MiB boundary and preserves the draft and layout until preview confirmation", async ({ page }) => {
  await page.goto("/manual");
  await expect(page.locator("[data-manual-schedule-page]")).toBeVisible();
  await expect(page.locator('[data-room-title="贸易站 1"] [data-operator-identity="阿米娅"]')).toBeVisible();
  const before = await workspaceData(page);
  const trigger = page.getByRole("button", { name: "导入排班文件", exact: true });
  await trigger.click();
  const upload = page.locator(uploadSelector);
  await expect(upload).toHaveAccessibleName("导入排班文件");
  await expect(upload).toContainText("5 MiB");
  await chooseFile(page, upload, jsonFile("schedule.json", { plans: [] }));
  await expect(upload.getByRole("alert")).toBeVisible();
  expect(await workspaceData(page)).toEqual(before);

  const buffer = Buffer.alloc(5 * 1024 * 1024, " ");
  Buffer.from(JSON.stringify(importedSchedule)).copy(buffer);
  await chooseFile(page, upload, { name: "schedule.json", mimeType: "application/json", buffer: Buffer.concat([buffer, Buffer.from(" ")]) });
  await expect(upload.getByRole("alert")).toContainText(/5\s*MiB/);
  expect(await workspaceData(page)).toEqual(before);

  await chooseFile(page, upload, { name: "schedule.json", mimeType: "", buffer });
  const preview = page.getByRole("dialog", { name: "导入这个 MAA 排班？" });
  await expect(upload).toHaveCount(0);
  await expect(preview).toContainText("schedule.json");
  await expectFocusWithin(preview);
  expect(await workspaceData(page)).toEqual(before);
  await preview.getByRole("button", { name: "取消", exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(await workspaceData(page)).toEqual(before);

  await trigger.click();
  await upload.locator("[data-file-dropzone]").drop({ files: jsonFile("schedule.json", importedSchedule) });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "导入并替换草稿", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('[data-room-title="贸易站 1"] [data-operator-identity="锡兰"]')).toBeVisible();
  await expect.poll(async () => (await workspaceData(page)).manual).not.toEqual(before.manual);
  await expect.poll(async () => (await workspaceData(page)).layout).not.toEqual(before.layout);
});

test("cancelling a pending manual file read prevents its late result from opening a preview or replacing the draft", async ({ page }) => {
  await page.goto("/manual");
  await expect(page.locator("[data-manual-schedule-page]")).toBeVisible();
  await expect(page.locator('[data-room-title="贸易站 1"] [data-operator-identity="阿米娅"]')).toBeVisible();
  const before = await workspaceData(page);
  const trigger = page.getByRole("button", { name: "导入排班文件", exact: true });
  await trigger.click();
  const upload = page.locator(uploadSelector);
  await expect(upload).toHaveAccessibleName("导入排班文件");
  await page.evaluate(() => {
    const originalText = File.prototype.text;
    File.prototype.text = async function () {
      if (this.name !== "late-schedule.json") return originalText.call(this);
      document.documentElement.setAttribute("data-manual-upload-read-started", "true");
      await new Promise<void>((resolve) => window.addEventListener("release-manual-upload-read", () => resolve(), { once: true }));
      const value = await originalText.call(this);
      document.documentElement.setAttribute("data-manual-upload-read-finished", "true");
      return value;
    };
  });
  await chooseFile(page, upload, jsonFile("late-schedule.json", importedSchedule));
  await expect(page.locator("html")).toHaveAttribute("data-manual-upload-read-started", "true");
  await expect(upload.getByRole("status")).toContainText("正在读取");
  await expect(upload.getByRole("button", { name: "选择文件", exact: true })).toBeDisabled();
  await expect(upload.getByRole("button", { name: "取消", exact: true })).toBeEnabled();
  await upload.getByRole("button", { name: "取消", exact: true }).click();
  await expect(upload).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await workspaceData(page)).toEqual(before);

  await page.evaluate(() => window.dispatchEvent(new Event("release-manual-upload-read")));
  await expect(page.locator("html")).toHaveAttribute("data-manual-upload-read-finished", "true");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("dialog", { name: "导入这个 MAA 排班？" })).toHaveCount(0);
  await expect(upload).toHaveCount(0);
  await expect(page.locator('[data-room-title="贸易站 1"] [data-operator-identity="阿米娅"]')).toBeVisible();
  expect(await workspaceData(page)).toEqual(before);
});

test("mobile English upload supports the chooser, long filename errors and keyboard cancellation with reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => window.localStorage.setItem("infra-demo-locale", "en"));
  await page.goto("/manual");
  await expect(page.locator("[data-manual-schedule-page]")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const moreTools = page.locator("[data-manual-more-tools] > summary");
  await moreTools.click();
  await page.getByRole("button", { name: "Import schedule file", exact: true }).click();
  const upload = page.locator(uploadSelector);
  await expect(upload).toHaveAccessibleName("Import schedule file");
  await expect(upload).toContainText("5 MiB");
  await expect(upload.getByRole("button", { name: "Choose files", exact: true })).toBeVisible();
  await expectFocusWithin(upload);
  const before = await workspaceData(page);
  const cancelledChooser = page.waitForEvent("filechooser");
  await upload.getByRole("button", { name: "Choose files", exact: true }).click();
  await (await cancelledChooser).setFiles([]);
  await expect(upload).toBeVisible();
  await expect(upload.getByRole("alert")).toHaveCount(0);
  expect(await workspaceData(page)).toEqual(before);
  await chooseFile(page, upload, jsonFile(`${"long-file-name-".repeat(12)}.txt`, importedSchedule), true);
  await expect(upload.getByRole("alert")).toContainText("not supported");
  const bounds = await upload.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await upload.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await workspaceData(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(upload).toHaveCount(0);
  await expect(moreTools).toBeFocused();
  await expect(page.locator("[data-manual-schedule-page]")).toBeVisible();
  expect(await workspaceData(page)).toEqual(before);
});
