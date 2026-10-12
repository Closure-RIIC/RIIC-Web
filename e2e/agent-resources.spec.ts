import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";

test("admin resources publish, remain isolated while editing, and restore on mobile", async ({ page, context, baseURL }) => {
  const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;
  if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("Isolated test database required");
  const pool = new Pool({ connectionString: databaseUrl });
  const actor = `resources-e2e-${randomUUID()}`;
  const password = `Fixture-${randomUUID()}!`;
  const payload = { schema: 1, systemPrompt: "以简体中文回答，使用站内工具核实。", defaultPersona: "测试助理", personas: [{ id: "saileach", enabled: true, content: "温和的琴柳" }], skills: [{ id: "mechanism", title: "机制解释", purpose: "回答机制问题", enabled: true, content: "先读技能，再读知识正文。" }], knowledge: { version: "e2e-v1", policy: "事实需有依据", files: [{ path: "index/标题清单.md", content: "- `docs/制造站.md` 制造站机制" }, { path: "index/消歧字典.json", content: "{}" }, { path: "docs/制造站.md", content: "# 制造站\n技能生产力+30%。" }] } };
  try {
    await pool.query('INSERT INTO public."user" (id,name,email,email_verified,role) VALUES ($1,$1,$2,true,\'admin\')', [actor, `${actor}@example.test`]);
    await pool.query("INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), actor, await hashPassword(password)]);
    await pool.query("INSERT INTO app.billing_wallet (user_id,paid_points) VALUES ($1,20)", [actor]);
    expect((await context.request.post("/api/auth/sign-in/email", { headers: { origin: baseURL! }, data: { email: `${actor}@example.test`, password } })).status()).toBe(200);
    const initial = await context.request.post("/api/admin/agent/resources", { headers: { origin: baseURL! }, data: { action: "draft", payload, reason: "isolated e2e draft" } });
    expect(initial.status()).toBe(200);
    expect((await context.request.post("/api/admin/agent/resources", { headers: { origin: "https://foreign.test" }, data: { action: "import" } })).status()).toBe(403);
    await page.goto("/admin/agent");
    const editor = page.getByRole("region", { name: "Agent 资源管理" });
    await editor.getByRole("button", { name: "打开", exact: true }).first().click();
    await expect(editor.getByLabel("共享系统提示词", { exact: true })).toHaveValue(payload.systemPrompt);
    await editor.getByLabel("变更原因", { exact: true }).fill("publish resource e2e");
    await editor.getByRole("button", { name: "发布选中草稿", exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText("已发布，下一轮请求使用此版本。");
    const first = (await (await context.request.get("/api/admin/agent/resources")).json()).data.active.id;
    await editor.getByRole("button", { name: "任务指引", exact: true }).click();
    await editor.getByLabel("选择任务指引", { exact: true }).selectOption("mechanism");
    await editor.getByLabel("启用此指引", { exact: true }).uncheck();
    expect((await (await context.request.get("/api/admin/agent/resources")).json()).data.active.payload.skills[0].enabled).toBe(true);
    await editor.getByRole("button", { name: "保存为新草稿", exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText("草稿已保存，尚未生效。");
    await editor.getByRole("button", { name: "发布选中草稿", exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText("已发布，下一轮请求使用此版本。");
    expect((await (await context.request.get("/api/admin/agent/resources")).json()).data.active.payload.skills[0].enabled).toBe(false);
    const config = await context.request.get("/api/agent/chat");
    expect(config.status()).toBe(200); expect((await config.json()).data.personas.map((card: { id: string }) => card.id)).toEqual(["saileach"]);
    await page.setViewportSize({ width: 375, height: 812 });
    await editor.getByRole("row").filter({ hasText: first }).getByRole("button", { name: "恢复并发布", exact: true }).click();
    await expect.poll(async () => (await (await context.request.get("/api/admin/agent/resources")).json()).data.active.payload.skills[0].enabled).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await context.addCookies([{ name: "riic-locale", value: "en", domain: "127.0.0.1", path: "/" }]);
    await page.reload();
    await expect(page.getByRole("region", { name: "Agent resources" }).getByRole("button", { name: "System prompt", exact: true })).toBeVisible();
  } finally {
    await pool.query("DELETE FROM app.agent_policy_version WHERE kind='resources' AND author_id=$1", [actor]);
    await pool.query("DELETE FROM app.billing_admin_audit WHERE actor_id=$1", [actor]);
    await pool.query('DELETE FROM public."user" WHERE id=$1', [actor]);
    await pool.end();
  }
});
