import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";

test("reviewer previews imports, saves changes and follows a named batch without changing personal data", async ({ page, context, request, baseURL }, testInfo) => {
  test.skip(!process.env.AUTH_INTEGRATION_DATABASE_URL, "Requires an isolated authentication database.");
  test.setTimeout(180000);
  const pool = new Pool({ connectionString: process.env.AUTH_INTEGRATION_DATABASE_URL, max: 1 });
  const id = `quality-ui-${randomUUID()}`;
  const password = "Quality-Browser-Test-2026!";
  const timestamp = new Date().toISOString();
  const expiry = new Date(Date.now() + 86400000).toISOString();
  const input = { format: "riic-reproduction", version: 1, operbox: [{ id: "char_002_amiya", name: "阿米娅", own: true, elite: 2, level: 80, rarity: 5, potential: 6 }], layout: { template: "243", drone_cap: 235, scenario: {}, rooms: [{ id: "control", kind: "control_center", level: 5 }, { id: "power", kind: "power_plant", level: 3 }] }, rotation: "abc_12_6_6", fiammetta_enable: false };
  const draft = { id: "draft-ui", revision: 1, input: structuredClone(input), original: structuredClone(input), sources: [{ name: "贸易站复现.json" }], expiresAt: expiry };
  const versions = [{ id: "latest", label: "internal-latest", executableSha256: "a".repeat(64), createdAt: timestamp }, { id: "previous", label: "internal-previous", executableSha256: "b".repeat(64), createdAt: timestamp }];
  let imported = false;
  let submitted = false;
  let reads = 0;
  let edits = 0;
  let previews = 0;
  const personalWrites: string[] = [];
  const batch = { id: "batch-ui", label: "贸易站复查", status: "queued", createdAt: timestamp, expiresAt: expiry, bundleIds: ["latest"], cases: [{ id: "case-ui", status: "queued", sources: draft.sources, attempts: [] as { id: string; status: string; startedAt: string; finishedAt: string; summary: unknown }[] }] };
  try {
    await pool.query('INSERT INTO "user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, "Quality UI test", `${id}@example.test`, "reviewer"]);
    await pool.query("INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, await hashPassword(password)]);
    const login = await request.post("/api/auth/sign-in/email", { headers: { origin: baseURL! }, data: { email: `${id}@example.test`, password } });
    expect(login.status(), await login.text()).toBe(200);
    const sessionCookies: string[] = [];
    for (const header of login.headersArray().filter(header => header.name.toLowerCase() === "set-cookie")) {
      const pair = header.value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (!pair.slice(0, separator).endsWith("session_token")) continue;
      sessionCookies.push(pair);
      await context.addCookies([{ name: pair.slice(0, separator), value: pair.slice(separator + 1), domain: new URL(baseURL!).hostname, path: "/", httpOnly: true, secure: header.value.toLowerCase().includes("; secure"), sameSite: "Lax" }]);
    }
    expect(sessionCookies).toHaveLength(1);
    await context.addCookies([{ name: "riic-locale", value: "zh", domain: new URL(baseURL!).hostname, path: "/" }]);
    page.on("request", request => {
      if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method()) && new URL(request.url()).pathname.startsWith("/api/account/")) personalWrites.push(request.url());
    });
    await page.route("**/api/admin/quality**", async route => {
      const url = new URL(route.request().url());
      let data: unknown;
      if (url.pathname.endsWith("/import")) {
        previews++;
        data = { token: "preview-ui", entries: [{ id: "valid", name: "贸易站复现.json", error: null }, { id: "invalid", name: "broken.json", error: "JSON 无法解析，请检查文件是否完整。" }] };
      } else if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        if (body.action === "acceptImport") { expect(body.excluded).toEqual(["invalid"]); imported = true; data = [draft]; }
        else if (body.action === "edit") { expect(body.revision).toBe(1); expect(body.input.fiammetta_enable).toBe(true); draft.input = body.input; draft.revision = 2; edits++; data = draft; }
        else if (body.action === "batch") { expect(body.ids).toEqual([draft.id]); expect(body.bundleIds).toEqual(["latest"]); expect(body.label).toBe("贸易站复查"); submitted = true; data = batch; }
        else throw new Error(`Unexpected mutation: ${body.action}`);
      } else if (url.searchParams.get("kind") === "draft") data = draft;
      else if (url.searchParams.get("kind") === "batch") {
        reads++;
        if (reads >= 1) { batch.status = "completed"; batch.cases[0].status = "completed"; batch.cases[0].attempts = [{ id: "attempt-ui", status: "completed", startedAt: timestamp, finishedAt: timestamp, summary: null }]; }
        data = batch;
      } else if (url.searchParams.get("kind") === "result") data = { input: draft.input, results: [{ bundleId: "latest", ok: true, valid: true, elapsedMs: 250, summary: { daily: { trade: 12345, manu: 2345, power: 300 } }, response: { result: { maa: { title: "复现排班", plans: [0, 1, 2].map(index => ({ name: `班次 ${index + 1}`, rooms: { control: [{ operators: ["阿米娅"] }], power: [{ operators: [] }] } })) }, rotation: { shifts: [] } } } }], comparison: null };
      else data = { versions, drafts: imported ? [draft] : [], batches: submitted ? [batch] : [], isAdmin: false, worker: { at: new Date().toISOString() } };
      await route.fulfill({ json: { success: true, data } });
    });
    await page.goto("/admin/quality");
    await expect(page.getByRole("heading", { name: "复现测试工作台" })).toBeVisible();
    await expect(page.locator('nav a[href="/admin/quality"]')).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("管理求解器版本", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "开始测试", exact: true })).toBeDisabled();
    await expect(page.getByText("测试服务就绪", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "选择文件", exact: true }).click();
    const upload = page.locator("[data-file-upload-dialog]");
    await expect(upload).toHaveAccessibleName("选择 JSON 或 ZIP 文件");
    await expect(upload.locator('input[type="file"]')).toHaveAttribute("accept", ".json,.zip");
    const chooser = page.waitForEvent("filechooser");
    await upload.getByRole("button", { name: "选择文件", exact: true }).click();
    expect((await chooser).isMultiple()).toBe(true);
    await (await chooser).setFiles([{ name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) }, { name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{") }]);
    await expect(upload).toHaveCount(0);
    await expect(page.getByText(/已选择 2 个文件/)).toBeVisible();
    await page.getByRole("button", { name: "选择文件", exact: true }).click();
    await expect(upload).toBeVisible();
    await upload.locator("[data-file-dropzone]").drop({ files: [
      { name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) },
      // The API is mocked here; ZIP parsing is covered by server/quality/import.test.ts.
      { name: "cases.zip", mimeType: "application/zip", buffer: Buffer.from("PK") },
    ] });
    await expect(upload).toHaveCount(0);
    await expect(page.getByText(/已选择 2 个文件.*cases.zip/)).toBeVisible();
    await expect(page.getByRole("button", { name: /预览导入内容/ })).toBeEnabled();
    await page.getByRole("button", { name: /预览导入内容/ }).click();
    await expect(page.getByRole("button", { name: "导入 2 项并选中" })).toBeDisabled();
    await page.getByRole("listitem").filter({ hasText: "broken.json" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "选择文件", exact: true }).click();
    const cancelledChooser = page.waitForEvent("filechooser");
    await upload.getByRole("button", { name: "选择文件", exact: true }).click();
    await (await cancelledChooser).setFiles([]);
    await expect(upload.getByRole("alert")).toHaveCount(0);
    await upload.locator("[data-file-dropzone]").drop({ files: [
      { name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) },
      { name: "unsupported.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") },
    ] });
    await expect(upload.getByRole("alert")).toContainText("unsupported.txt");
    const manyFiles = Array.from({ length: 501 }, (_, index) => ({ name: `${index}.json`, mimeType: "", buffer: Buffer.from("{}") }));
    await upload.locator("[data-file-dropzone]").drop({ files: manyFiles });
    await expect(upload.getByRole("alert")).toContainText("最多选择 500 个文件");
    await page.keyboard.press("Escape");
    await expect(upload).toHaveCount(0);
    await expect(page.getByRole("button", { name: "选择文件", exact: true })).toBeFocused();
    await expect(page.getByText(/已选择 2 个文件.*cases.zip/)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "broken.json" }).getByRole("checkbox")).toBeChecked();
    await expect(page.getByRole("button", { name: "导入 1 项并选中" })).toBeEnabled();
    expect(imported).toBe(false);
    expect(previews).toBe(1);

    await page.getByRole("button", { name: "选择文件", exact: true }).click();
    await upload.locator("[data-file-dropzone]").drop({ files: manyFiles.slice(0, 500) });
    await expect(upload).toHaveCount(0);
    await expect(page.getByText(/已选择 500 个文件/)).toBeVisible();
    await expect(page.getByRole("button", { name: "导入 1 项并选中" })).toHaveCount(0);
    expect(previews).toBe(1);
    await page.getByRole("button", { name: "选择文件", exact: true }).click();
    await upload.locator("[data-file-dropzone]").drop({ files: { name: "replacement.JSON", mimeType: "", buffer: Buffer.from(JSON.stringify(input)) } });
    await expect(upload).toHaveCount(0);
    await expect(page.getByText(/已选择 1 个文件：replacement.JSON/)).toBeVisible();
    expect(imported).toBe(false);
    await page.getByRole("button", { name: /预览导入内容/ }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "broken.json" }).getByRole("checkbox")).not.toBeChecked();
    await page.getByRole("listitem").filter({ hasText: "broken.json" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "导入 1 项并选中" }).click();
    await page.getByRole("button", { name: "贸易站复现.json", exact: true }).click();
    const editor = page.getByRole("region", { name: "编辑复现草稿" });
    await editor.getByRole("checkbox", { name: "启用菲亚梅塔回满心情" }).check();
    await expect(page.getByRole("button", { name: /开始测试/ })).toBeDisabled();
    await expect(page.getByText("有未保存的修改", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "保存并选中草稿" }).click();
    await expect(page.getByText("已保存 · 第 2 版", { exact: true })).toBeVisible();
    await expect(editor.getByText(/新增或调整干员/)).toHaveCount(0);
    expect(edits).toBe(1);
    await page.getByLabel("批次名称（选填）").fill("贸易站复查");
    await page.getByRole("combobox", { name: "对比方式" }).click();
    await page.getByRole("option", { name: /最新生产版/ }).click();
    await expect(page.getByRole("button", { name: /开始测试/ })).toBeDisabled();
    await expect(page.getByText("对比版本需要与测试版本不同，或选择单版本测试。", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "对比方式" }).click();
    await page.getByRole("option", { name: "不对比，仅测试所选版本" }).click();
    await page.getByRole("button", { name: /开始测试/ }).click();
    await expect(page.getByRole("progressbar", { name: "批次进度" })).toHaveAttribute("value", "1", { timeout: 15000 });
    await page.getByRole("button", { name: "第 1 次 · 已完成 · 查看结果" }).click();
    const resultPanel = page.getByRole("region", { name: "执行结果", exact: true });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(resultPanel.getByRole("heading", { name: "执行结果", exact: true })).toBeInViewport();
    await resultPanel.getByRole("combobox", { name: "查看班次" }).click();
    await page.getByRole("option", { name: "第 3 班", exact: true }).click();
    await expect(resultPanel.getByRole("combobox", { name: "查看班次" })).toHaveValue("第 3 班");
    await expect(page.getByText("排班结果有效", { exact: true })).toBeVisible();
    await expect(page.getByText("12,345", { exact: true })).toBeVisible();
    await expect(page.getByText("本次为单版本测试，不生成版本差异结论。", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("quality-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "返回批次用例", exact: true }).click();
    await expect(page.getByRole("region", { name: "贸易站复查", exact: true }).getByRole("heading").first()).toBeInViewport();
    await page.getByRole("button", { name: "第 1 次 · 已完成 · 查看结果" }).click();
    await expect(resultPanel.getByRole("heading", { name: "执行结果", exact: true })).toBeInViewport();
    await resultPanel.getByText("完整执行记录（JSON）", { exact: true }).click();
    await expect(resultPanel.locator("pre")).toBeVisible();
    await expect.poll(() => resultPanel.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("quality-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: /查看测试结果/ }).click();
    const history = page.getByRole("region", { name: "3. 测试记录与结果" });
    await expect(history.getByRole("heading")).toBeInViewport();
    await history.getByRole("button", { name: /贸易站复查.*查看结果/ }).click();
    await expect(page.getByRole("region", { name: "贸易站复查", exact: true }).getByRole("heading").first()).toBeInViewport();
    await page.getByRole("button", { name: "第 1 次 · 已完成 · 查看结果" }).click();
    await expect(resultPanel.getByText("12,345", { exact: true })).toBeVisible();
    await expect(resultPanel.getByRole("heading", { name: "执行结果", exact: true })).toBeInViewport();
    expect(submitted).toBe(true);
    expect(personalWrites).toEqual([]);
    imported = false;
    submitted = false;
    versions.splice(1);
    await context.addCookies([{ name: "riic-locale", value: "en", domain: new URL(baseURL!).hostname, path: "/" }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Reproduction workbench" })).toBeVisible();
    await expect(page.getByText("Only one production version is available. You can run a single-version test.", { exact: true })).toBeVisible();
    await expect(page.getByText("No drafts yet. Upload a file or reproduce an issue from feedback details.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run tests", exact: true })).toBeDisabled();
  } finally {
    await pool.query('DELETE FROM "user" WHERE id=$1', [id]);
    await pool.end();
  }
});
