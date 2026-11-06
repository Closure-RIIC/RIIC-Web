import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";

test("admin billing, filter policies, role boundaries and automatic Agent selection", async ({page,context,browser,baseURL})=>{
  const url=process.env.AUTH_INTEGRATION_DATABASE_URL;
  if(!url||!new URL(url).pathname.endsWith("_test"))throw new Error("Isolated *_test database required");
  const pool=new Pool({connectionString:url,max:2});const users:string[]=[];const reviewer=await browser.newContext({baseURL});
  const paymentId=randomUUID();const trade=`afdian-e2e-${paymentId}`;
  async function login(target:BrowserContext,role:string){
    const id=`agent-e2e-${randomUUID()}`;const password="Agent-E2E-2026!";users.push(id);
    await pool.query('INSERT INTO public."user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)',[id,`Agent ${role}`,`${id}@example.test`,role]);
    await pool.query("INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)",[randomUUID(),id,await hashPassword(password)]);
    const response=await target.request.post("/api/auth/sign-in/email",{headers:{origin:baseURL!},data:{email:`${id}@example.test`,password}});
    expect(response.status()).toBe(200);return id;
  }
  try {
    const admin=await login(context,"admin");await login(reviewer,"reviewer");
    await pool.query("INSERT INTO app.billing_wallet (user_id,paid_points) VALUES ($1,20)",[admin]);
    await pool.query("INSERT INTO app.billing_payment (id,provider,provider_order_id,amount_fen,provider_status,status,evidence) VALUES ($1,'afdian',$2,30,2,'review',$3)",[paymentId,trade,JSON.stringify({trade})]);
    await pool.query("INSERT INTO app.billing_review (id,kind,evidence) VALUES ($1,'afdian_payment',$2)",["payment:"+paymentId,JSON.stringify({paymentId,trade})]);
    for(const section of ["summary","wallets","policies","audit"]){expect((await reviewer.request.get(`/api/admin/billing?section=${section}`)).status()).toBe(403);}
    expect((await context.request.post("/api/admin/billing?section=adjust",{headers:{origin:"https://other.test"},data:{userId:admin,action:"credit",points:1,reason:"forged",idempotencyKey:randomUUID()}})).status()).toBe(403);
    await page.goto("/admin/billing");await expect(page.getByRole("heading",{name:"计费管理",exact:true})).toBeVisible();
    await expect(page.getByText("已知模型成本 ¥",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"用户钱包",exact:true}).click();
    await page.getByRole("row").filter({hasText:admin}).getByRole("button",{name:"调账",exact:true}).click();
    await page.getByLabel("爱发电交易号（可选；填写后核验付款并关闭对账）",{exact:true}).fill(trade);
    await page.getByRole("dialog").getByRole("combobox").selectOption("debit");
    await page.getByRole("dialog").getByRole("combobox").selectOption("credit");
    await expect(page.getByLabel("爱发电交易号（可选；填写后核验付款并关闭对账）",{exact:true})).toHaveValue("");
    await page.getByLabel("爱发电交易号（可选；填写后核验付款并关闭对账）",{exact:true}).fill(trade);
    await page.getByLabel("积分数",{exact:true}).fill("3");await page.getByLabel("操作原因",{exact:true}).fill("E2E adjustment");
    await page.getByRole("button",{name:"确认调账",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async()=>Number((await pool.query("SELECT paid_points FROM app.billing_wallet WHERE user_id=$1",[admin])).rows[0].paid_points)).toBe(23);
    expect((await pool.query("SELECT status FROM app.billing_payment WHERE id=$1",[paymentId])).rows[0].status).toBe("fulfilled");
    expect((await pool.query("SELECT status FROM app.billing_review WHERE id=$1",["payment:"+paymentId])).rows[0].status).toBe("resolved");
    await page.getByRole("button",{name:"积分流水",exact:true}).click();await expect(page.getByRole("table")).toContainText("admin_credit");
    await page.getByRole("button",{name:"模型费率",exact:true}).click();await expect(page.getByText("deepseek-v4.1-flash",{exact:true})).toBeVisible();
    await page.goto("/admin/agent");await expect(page.getByRole("heading",{name:"Agent 管理",exact:true})).toBeVisible();
    await page.getByLabel("测试文本（不会保存）",{exact:true}).fill("RIIC_FILTER_BLOCK_TEST");await page.getByRole("button",{name:"测试规则",exact:true}).click();await expect(page.getByText(/1 处命中/)).toBeVisible();
    await page.getByLabel("变更原因",{exact:true}).fill("E2E unchanged policy version");await page.getByRole("button",{name:"保存草稿",exact:true}).click();
    await expect(page.getByRole("button",{name:"发布",exact:true})).toBeVisible();await page.getByRole("button",{name:"发布",exact:true}).click();await page.getByRole("button",{name:"确认发布",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
    const access=await context.request.get("/api/agent/chat");expect(access.status()).toBe(200);const config=await access.json();expect(config.data.automatic).toBe(true);expect(config.data.models).toEqual([]);
    const rejected=await context.request.post("/api/agent/chat",{headers:{origin:baseURL!},data:{conversationId:randomUUID(),attemptId:randomUUID(),messages:[{id:randomUUID(),role:"user",parts:[{type:"text",text:"RIIC_FILTER_BLOCK_TEST"}]}]}});
    expect(rejected.status()).toBe(400);expect((await pool.query("SELECT paid_points FROM app.billing_wallet WHERE user_id=$1",[admin])).rows[0].paid_points).toBe("23.0000");
    await page.setViewportSize({width:375,height:812});await page.goto("/admin/billing");await expect(page.getByRole("heading",{name:"计费管理",exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    await context.addCookies([{name:"riic-locale",value:"en",domain:"127.0.0.1",path:"/"}]);await page.reload();await expect(page.getByRole("heading",{name:"Billing",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Usage & cost",exact:true})).toBeVisible();
  }finally{await reviewer.close();await pool.query("DELETE FROM app.billing_review WHERE id=$1",["payment:"+paymentId]);await pool.query("DELETE FROM app.billing_payment WHERE id=$1",[paymentId]);await pool.query('DELETE FROM public."user" WHERE id=any($1::text[])',[users]);await pool.end();}
});
