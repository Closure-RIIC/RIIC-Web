import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { setImmediate } from "node:timers";
import { build } from "esbuild";
import React from "react";
import { act, create } from "react-test-renderer";
import { IntlProvider } from "use-intl";
import { registerMessages } from "@riic/arknights-domain/i18n/localize";

const { Response, structuredClone } = globalThis;
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const repository = path.resolve(root, "../..");
let temporary;
let compiled;
let messages;
let previousActEnvironment;

before(async () => {
  previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  messages = {
    Admin_policy_editor: JSON.parse(await readFile(path.join(root, "messages/zh-CN/Admin_policy_editor.json"), "utf8")),
    Common: { requestFailed: "请求失败" },
  };
  registerMessages("zh-CN", messages);
  temporary = await mkdtemp(path.join(root, ".model-settings-test-"));
  const outfile = path.join(temporary, "editor.mjs");
  await build({
    stdin: { contents: `
      export { ModelSettingsEditor } from "./src/app/admin/billing/model-settings-editor.tsx";
      export { AdminDataProvider } from "./src/app/admin/admin-context.tsx";
      export { Input } from "./src/components/ui/input.tsx";
      export { Button } from "./src/components/ui/button.tsx";
    `, resolveDir: root, sourcefile: "model-settings-test-entry.tsx", loader: "tsx" },
    outfile, bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
    alias: { "@": path.join(root, "src"), "@riic/ui-primitives": path.join(repository, "packages/ui-primitives") },
    plugins: [{ name: "inline-dialog", setup(builder) {
      builder.onResolve({ filter: /^react$/, namespace: "test-dialog" }, args => ({ path: args.path, external: true }));
      builder.onResolve({ filter: /^@\/components\/ui\/dialog$/ }, () => ({ path: "dialog", namespace: "test-dialog" }));
      builder.onLoad({ filter: /.*/, namespace: "test-dialog" }, () => ({ contents: `
        import { createElement } from "react";
        export const Dialog=({open,children})=>open ? createElement("div",{"data-test-dialog":true},children) : null;
        export const DialogContent=({children,...props})=>createElement("div",{...props,role:"dialog"},children);
        export const DialogTitle=({children})=>createElement("h2",null,children);
        export const DialogDescription=({children})=>createElement("p",null,children);
        export const DialogHeader=({children})=>createElement("div",null,children);
        export const DialogFooter=({children})=>createElement("div",null,children);
      ` }));
    } }],
  });
  compiled = await import(pathToFileURL(outfile).href);
});

after(async () => {
  if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  if (temporary) {
    const relative = path.relative(root, path.resolve(temporary));
    assert.ok(relative.startsWith(".model-settings-test-") && !relative.includes(path.sep));
    await rm(temporary, { recursive: true, force: true });
  }
});

// Artificial prices exercise editing and transport only; no account, database or supplier is contacted.
function fixture({ gptRate = true } = {}) {
  const identities = [
    ["deepseek", "DeepSeek Flash", "riic-deepseek", "deepseek-v4.1-flash"],
    ["glm", "GLM-5.3 Flash", "riic-glm", "glm-5.3-flash"],
    ["gpt", "GPT-6.1 Sol", "riic-gpt", "gpt-6.1-sol"],
  ];
  const payload = {
    schema: 1,
    rates: { markup: "1.2", pointValueRmb: "0.1", toolPoints: 1, models: identities.filter(([id]) => id !== "gpt" || gptRate).map(([, , provider, model]) => ({ provider, model, currency: "RMB", exchangeRate: "1", input: "3", cachedInput: "0.03", output: "9", ...(provider === "riic-gpt" ? { peak: { input: "5", cachedInput: "0.05", output: "12" } } : {}) })) },
    models: { schema: 1, defaultModel: "deepseek", models: identities.map(([id, label]) => ({ id, label, enabled: id !== "gpt", maxImages: id === "gpt" ? 4 : 0, maxImageBytes: 8 * 1024 * 1024, maxImagePixels: 16_000_000, imageTokensPerImage: id === "gpt" ? 8192 : 0 })) },
  };
  const active = { id: "settings:active", ratesId: "rates:active", modelsId: "models:active", payload };
  const draft = structuredClone(payload);
  draft.models.models.find(model => model.id === "gpt").label = "已保存 GPT";
  draft.rates.models.find(rate => rate.provider === "riic-deepseek").input = "7";
  return {
    settings: { active, initialPayload: payload, expectedActive: { ratesId: active.ratesId, modelsId: active.modelsId }, versions: [
      { id: "settings:draft", version: 3, status: "draft", payload: draft, created_at: "2026-11-21T00:00:00.000Z", ratesId: null, modelsId: null },
      { ...active, version: 2, status: "active", created_at: "2026-11-20T00:00:00.000Z" },
      { id: "settings:old", version: 1, status: "retired", payload: structuredClone(payload), created_at: "2026-11-19T00:00:00.000Z", ratesId: "rates:old", modelsId: "models:old" },
    ] },
    modelChoices: identities.map(([id, label]) => ({ id, label, vision: id === "gpt", available: id !== "gpt", ...(id === "gpt" ? { reason: "disabled" } : {}) })),
    rateModels: [...identities.map(([id, , provider, model]) => ({ id, provider, model })), { id: "deepseek-official", provider: "riic-deepseek-official", model: "deepseek-flash" }],
  };
}

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node.children.map(text).join("");
}
function labelText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node.type === "select" || node.type === "input" || node.type === compiled.Input) return "";
  return node.children.map(labelText).join("");
}
function button(scope, label) {
  const matches = scope.findAllByType(compiled.Button).filter(node => text(node) === label);
  assert.equal(matches.length, 1, `button ${label}`);
  return matches[0];
}
function field(scope, label) {
  const labels = scope.findAllByType("label").filter(node => labelText(node) === label);
  assert.equal(labels.length, 1, `field ${label}`);
  const input = labels[0].findAllByType(compiled.Input)[0];
  return input ?? labels[0].find(node => node.type === "select" || node.type === "input");
}
const card = (renderer, id) => renderer.root.findByProps({ "data-model-settings-card": id });
const change = (control, value) => act(async () => { control.props.onChange({ target: { value, checked: value }, currentTarget: { value, checked: value } }); });
const click = target => act(async () => { target.props.onClick(); await new Promise(resolve => setImmediate(resolve)); });

async function mount(t, data = fixture()) {
  const requests = [];
  let refreshes = 0;
  let failure;
  const request = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return failure
      ? Response.json({ success: false, error: { message: failure } }, { status: 409 })
      : Response.json({ success: true, data: { id: "settings:saved" } });
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(IntlProvider, { locale: "zh-CN", messages, timeZone: "Asia/Shanghai" },
    React.createElement(compiled.AdminDataProvider, { request, basePath: "/admin" },
      React.createElement(compiled.ModelSettingsEditor, { ...data, refresh: async () => { refreshes++; } })))); });
  t.after(async () => { await act(async () => { renderer.unmount(); }); });
  return { renderer, requests, data, refreshes: () => refreshes, failWith: message => { failure = message; } };
}

test("model settings show four actual routes without inventing missing prices", async t => {
  const data = fixture({ gptRate: false });
  const original = structuredClone(data.settings.active.payload);
  const { renderer, requests } = await mount(t, data);
  const cards = renderer.root.findAll(node => node.type === "fieldset" && node.props["data-model-settings-card"]);
  assert.deepEqual(cards.map(node => node.props["data-model-settings-card"]), ["deepseek", "glm", "gpt", "deepseek-official"]);
  assert.equal(renderer.root.findAllByType(compiled.Button).filter(node => text(node) === "保存草稿").length, 1);
  assert.equal(card(renderer, "gpt").findByType("details").props.open, undefined);
  assert.deepEqual(data.settings.active.payload, original);
  assert.equal(requests.length, 0);
  await click(button(card(renderer, "gpt"), "添加费率"));
  for (const label of ["输入", "缓存读取", "输出"]) assert.equal(field(card(renderer, "gpt"), label).props.value, "");
  assert.equal(card(renderer, "gpt").findAllByType("input").find(node => node.props.type === "checkbox").props.checked, false);
});

test("one draft request contains model, rate, default and image edits with the active pair", async t => {
  const { renderer, requests, refreshes, data } = await mount(t);
  const gpt = () => card(renderer, "gpt");
  await change(field(gpt(), "允许用户选择"), true);
  await change(field(renderer.root, "新会话默认模型"), "gpt");
  await change(field(renderer.root, "服务倍率"), "1.4");
  await change(field(gpt(), "显示名称"), "测试识图模型");
  await change(field(gpt(), "输入"), "4.2");
  await change(field(gpt(), "每轮最多图片数"), "8");
  await change(field(gpt(), "每张图片输入 token 预留量"), "10000");
  for (const label of ["每轮最多图片数", "单图文件大小上限（MiB）", "单图解码像素上限（百万像素）", "每张图片输入 token 预留量"]) assert.equal(field(gpt(), label).props.max, undefined);
  assert.doesNotMatch(text(gpt()), /262144|图文共用输入上限|图片预算模式/);
  await change(field(gpt(), "单图文件大小上限（MiB）"), "10");
  await change(field(gpt(), "单图解码像素上限（百万像素）"), "32");
  await change(field(renderer.root, "变更原因"), "统一编辑模型和费率");
  await click(button(renderer.root, "保存草稿"));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/admin/billing?section=model-settings");
  const { body } = requests[0];
  assert.deepEqual(body.expectedActive, { ratesId: "rates:active", modelsId: "models:active" });
  assert.equal(body.action, "draft");
  assert.equal(body.payload.models.defaultModel, "gpt");
  const chosen = body.payload.models.models.find(model => model.id === "gpt");
  assert.deepEqual([chosen.enabled, chosen.label, chosen.maxImages, chosen.maxImageBytes, chosen.maxImagePixels, chosen.imageTokensPerImage], [true, "测试识图模型", 8, 10 * 1024 * 1024, 32_000_000, 10000]);
  assert.equal(body.payload.rates.markup, "1.4");
  assert.equal(body.payload.rates.models.find(rate => rate.provider === "riic-gpt").input, "4.2");
  assert.deepEqual(body.payload.rates.models.filter(rate => rate.provider !== "riic-gpt"), data.settings.active.payload.rates.models.filter(rate => rate.provider !== "riic-gpt"));
  assert.equal(refreshes(), 1);
});

test("GPT tiers initialize exact decimal and peak prices then remain independently editable", async t => {
  const { renderer, requests } = await mount(t);
  const gpt = () => card(renderer, "gpt");
  const long = () => gpt().findByProps({ "data-model-long-context-rates": true });
  await click(button(gpt(), "添加长上下文档位"));
  assert.deepEqual([field(long(), "输入").props.value, field(long(), "缓存读取").props.value, field(long(), "输出").props.value], ["6", "0.06", "13.5"]);
  assert.deepEqual([field(long(), "高峰 · 输入").props.value, field(long(), "高峰 · 缓存读取").props.value, field(long(), "高峰 · 输出").props.value], ["10", "0.1", "18"]);
  await change(field(long(), "输入"), "7.7");
  await change(field(long(), "高峰 · 输出"), "22.25");
  const baseInput = gpt().findAllByType("label").filter(node => text(node) === "输入")[0].findByType(compiled.Input);
  await change(baseInput, "3.7");
  await change(field(renderer.root, "变更原因"), "独立设置两个计费档位");
  await click(button(renderer.root, "保存草稿"));
  const rate = requests[0].body.payload.rates.models.find(row => row.provider === "riic-gpt");
  assert.equal(rate.input, "3.7");
  assert.deepEqual(rate.longContext, { inputTokenThreshold: 272000, input: "7.7", cachedInput: "0.06", output: "13.5", peak: { input: "10", cachedInput: "0.1", output: "22.25" } });
  assert.deepEqual(rate.peak, { input: "5", cachedInput: "0.05", output: "12" });
  await change(field(gpt(), "使用高峰费率"), false);
  await click(button(renderer.root, "保存草稿"));
  const noPeak = requests[1].body.payload.rates.models.find(row => row.provider === "riic-gpt");
  assert.equal(noPeak.peak, undefined);
  assert.equal(noPeak.longContext.peak, undefined);
});

test("long-context initialization rounds tiny prices up and leaves out-of-range prices blank", async t => {
  const data = fixture();
  Object.assign(data.settings.active.payload.rates.models.find(rate => rate.provider === "riic-gpt"), {
    input: "5000000", cachedInput: "0.00000001", output: "0.00000001",
  });
  const { renderer } = await mount(t, data);
  await click(button(card(renderer, "gpt"), "添加长上下文档位"));
  const long = card(renderer, "gpt").findByProps({ "data-model-long-context-rates": true });
  assert.equal(field(long, "输入").props.value, "");
  assert.equal(field(long, "缓存读取").props.value, "0.00000002");
  assert.equal(field(long, "输出").props.value, "0.00000002");
  assert.equal(data.settings.active.payload.rates.models.find(rate => rate.provider === "riic-gpt").output, "0.00000001");
});

test("publish previews and submits the saved version, preserves edits and keeps a failed dialog open", async t => {
  const { renderer, requests, refreshes, failWith, data } = await mount(t);
  await change(field(card(renderer, "gpt"), "显示名称"), "未保存的 GPT 名称");
  await change(field(card(renderer, "deepseek"), "输入"), "99");
  await change(field(renderer.root, "变更原因"), "发布已审阅版本");
  await click(button(renderer.root, "发布"));
  const dialog = () => renderer.root.findByProps({ role: "dialog" });
  assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 1);
  const saved = data.settings.versions.find(version => version.status === "draft");
  assert.deepEqual(JSON.parse(text(dialog().findByType("pre"))), saved.payload);
  assert.match(text(dialog()), /已保存 GPT/);
  assert.doesNotMatch(text(dialog()), /未保存的 GPT 名称/);
  failWith("配置版本已变化，请刷新后重试");
  await click(button(dialog(), "确认发布"));
  assert.match(text(dialog().findByProps({ role: "alert" })), /配置版本已变化/);
  assert.equal(refreshes(), 0);
  assert.equal(field(card(renderer, "gpt"), "显示名称").props.value, "未保存的 GPT 名称");
  assert.deepEqual(requests[0].body, { action: "publish", id: saved.id, reason: "发布已审阅版本", expectedActive: { ratesId: "rates:active", modelsId: "models:active" } });
  failWith(undefined);
  await click(button(dialog(), "确认发布"));
  assert.equal(refreshes(), 1);
  assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 0);
});

test("restoring a version submits one combined rollback request", async t => {
  const { renderer, requests, data } = await mount(t);
  await change(field(renderer.root, "变更原因"), "恢复已核对的联合版本");
  await click(button(renderer.root, "回滚至此版本"));
  const dialog = renderer.root.findByProps({ role: "dialog" });
  assert.deepEqual(JSON.parse(text(dialog.findByType("pre"))), data.settings.versions.find(version => version.status === "retired").payload);
  await click(button(dialog, "确认回滚"));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.action, "rollback");
  assert.equal(requests[0].body.id, "settings:old");
  assert.equal(requests[0].body.payload, undefined);
});


test("first publication requires an explicit multiplier and uses the initial optimistic pair", async t => {
  const data = fixture();
  data.settings.active = null;
  data.settings.initialPayload = structuredClone(data.settings.initialPayload);
  data.settings.initialPayload.rates.markup = "";
  data.settings.expectedActive = { ratesId: null, modelsId: "models:initial" };
  const { renderer, requests } = await mount(t, data);
  assert.equal(field(renderer.root, "服务倍率").props.value, "");
  assert.match(text(renderer.root), /尚未发布/);
  await change(field(renderer.root, "服务倍率"), "1.35");
  await change(field(renderer.root, "变更原因"), "explicit initial publication");
  await click(button(renderer.root, "保存草稿"));
  assert.equal(requests[0].body.payload.rates.markup, "1.35");
  assert.deepEqual(requests[0].body.expectedActive, data.settings.expectedActive);
  await click(button(renderer.root, "发布"));
  await click(button(renderer.root.findByProps({ role: "dialog" }), "确认发布"));
  assert.equal(requests[1].body.action, "publish");
  assert.deepEqual(requests[1].body.expectedActive, data.settings.expectedActive);
});

test("official route prices and holidays survive unrelated edits and appear in the publication snapshot", async t => {
  const data = fixture();
  const official = { provider: "riic-deepseek-official", model: "deepseek-flash", currency: "RMB", exchangeRate: "1",
    input: "1", cachedInput: "0.02", output: "4", peak: { input: "2", cachedInput: "0.04", output: "8" }, offPeakDates: ["2027-01-01", "2027-02-05"] };
  data.settings.active.payload.rates.models.push(structuredClone(official));
  data.settings.versions[0].payload.rates.models.push(structuredClone(official));
  const { renderer, requests } = await mount(t, data);
  const officialCard = card(renderer, "deepseek-official");
  assert.equal(field(officialCard, "实际供应商型号").props.readOnly, true);
  assert.equal(officialCard.findAllByType("label").some(node => labelText(node) === "允许用户选择"), false);
  await change(field(card(renderer, "glm"), "输入"), "1.23");
  await change(field(renderer.root, "变更原因"), "preserve independent official rate");
  await click(button(renderer.root, "保存草稿"));
  assert.deepEqual(requests[0].body.payload.rates.models.find(rate => rate.provider === official.provider), official);
  await change(field(card(renderer, "deepseek-official"), "使用高峰费率"), false);
  await click(button(renderer.root, "保存草稿"));
  const disabled = requests[1].body.payload.rates.models.find(rate => rate.provider === official.provider);
  assert.equal(disabled.peak, undefined);
  assert.deepEqual(disabled.offPeakDates, official.offPeakDates);
  await click(button(renderer.root, "发布"));
  const snapshot = renderer.root.findByProps({ "data-official-rate-snapshot": true });
  assert.match(text(snapshot), /deepseek-flash/);
  assert.match(text(snapshot), /2027-01-01, 2027-02-05/);
});

test("route identities are read-only and rebind only after an explicit administrator action", async t => {
  const data = fixture();
  data.rateModels.find(route => route.id === "gpt").model = "supplier-gpt-current";
  const { renderer, requests } = await mount(t, data);
  assert.equal(field(card(renderer, "gpt"), "实际供应商型号").props.value, "gpt-6.1-sol");
  assert.equal(field(card(renderer, "gpt"), "实际供应商型号").props.readOnly, true);
  await click(button(card(renderer, "gpt"), "使用当前线路型号"));
  assert.equal(field(card(renderer, "gpt"), "实际供应商型号").props.value, "supplier-gpt-current");
  await change(field(renderer.root, "变更原因"), "confirm prices for current route");
  await click(button(renderer.root, "保存草稿"));
  assert.equal(requests[0].body.payload.rates.models.find(rate => rate.provider === "riic-gpt").model, "supplier-gpt-current");
});


test("the off-peak calendar keeps a new line while typing and saves separate dates", async t => {
  const { renderer, requests } = await mount(t);
  const calendar = () => card(renderer, "glm").findByType("textarea");
  await change(calendar(), "2027-01-01\n");
  assert.equal(calendar().props.value, "2027-01-01\n");
  await change(calendar(), "2027-01-01\n2027-02-05");
  await change(field(renderer.root, "变更原因"), "calendar edit");
  await click(button(renderer.root, "保存草稿"));
  assert.deepEqual(requests[0].body.payload.rates.models.find(rate => rate.provider === "riic-glm").offPeakDates, ["2027-01-01", "2027-02-05"]);
});

test("cache-write pricing is opt-in for every route and never invents a price", async t => {
  const { renderer, requests, data } = await mount(t);
  await click(button(card(renderer, "deepseek-official"), "添加费率"));
  for (const id of ["deepseek", "glm", "gpt", "deepseek-official"]) {
    assert.equal(field(card(renderer, id), "单独计算缓存写入").props.checked, false);
  }
  for (const id of ["deepseek", "glm", "deepseek-official"]) {
    await change(field(card(renderer, id), "单独计算缓存写入"), true);
    assert.equal(field(card(renderer, id), "缓存写入").props.value, "");
    await change(field(card(renderer, id), "缓存写入"), "0");
  }
  await change(field(renderer.root, "变更原因"), "explicit optional cache-write prices");
  await click(button(renderer.root, "保存草稿"));
  for (const provider of ["riic-deepseek", "riic-glm", "riic-deepseek-official"]) {
    assert.equal(requests[0].body.payload.rates.models.find(rate => rate.provider === provider).cacheWrite, "0");
  }
  assert.equal(Object.hasOwn(requests[0].body.payload.rates.models.find(rate => rate.provider === "riic-gpt"), "cacheWrite"), false);
  assert.equal(data.settings.active.payload.rates.models.some(rate => Object.hasOwn(rate, "cacheWrite")), false);
});

test("the cache-write switch edits and removes all existing price tiers in one draft", async t => {
  const { renderer, requests } = await mount(t);
  const gpt = () => card(renderer, "gpt");
  await click(button(gpt(), "添加长上下文档位"));
  await change(field(gpt(), "单独计算缓存写入"), true);
  const writeFields = () => gpt().findAllByType("label")
    .filter(node => /^(高峰 · )?缓存写入$/.test(labelText(node))).map(node => node.findByType(compiled.Input));
  assert.deepEqual(writeFields().map(node => node.props.value), ["", "", "", ""]);
  for (const [index, price] of ["1.25", "2.5", "3.75", "5"].entries()) await change(writeFields()[index], price);
  await change(field(renderer.root, "变更原因"), "four explicit cache-write rates");
  await click(button(renderer.root, "保存草稿"));
  const saved = requests[0].body.payload.rates.models.find(rate => rate.provider === "riic-gpt");
  assert.deepEqual([saved.cacheWrite, saved.peak.cacheWrite, saved.longContext.cacheWrite, saved.longContext.peak.cacheWrite], ["1.25", "2.5", "3.75", "5"]);
  assert.deepEqual([saved.input, saved.peak.input, saved.longContext.input, saved.longContext.peak.input], ["3", "5", "6", "10"]);
  await change(field(gpt(), "单独计算缓存写入"), false);
  assert.equal(writeFields().length, 0);
  await click(button(renderer.root, "保存草稿"));
  const disabled = requests[1].body.payload.rates.models.find(rate => rate.provider === "riic-gpt");
  for (const prices of [disabled, disabled.peak, disabled.longContext, disabled.longContext.peak]) assert.equal(Object.hasOwn(prices, "cacheWrite"), false);
  await change(field(gpt(), "单独计算缓存写入"), true);
  assert.deepEqual(writeFields().map(node => node.props.value), ["", "", "", ""]);
});

test("new long-context and peak tiers retain cache-write structure with blank prices", async t => {
  const data = fixture();
  delete data.settings.active.payload.rates.models.find(rate => rate.provider === "riic-gpt").peak;
  const { renderer } = await mount(t, data);
  const gpt = () => card(renderer, "gpt");
  await change(field(gpt(), "单独计算缓存写入"), true);
  await change(field(gpt(), "缓存写入"), "0");
  await click(button(gpt(), "添加长上下文档位"));
  const long = () => gpt().findByProps({ "data-model-long-context-rates": true });
  assert.equal(field(long(), "缓存写入").props.value, "");
  await change(field(gpt(), "使用高峰费率"), true);
  assert.equal(field(long(), "高峰 · 缓存写入").props.value, "");
  const writes = gpt().findAllByType("label").filter(node => /^(高峰 · )?缓存写入$/.test(labelText(node))).map(node => node.findByType(compiled.Input).props.value);
  assert.deepEqual(writes, ["0", "", "", ""]);
});

test("saved publication snapshots display each cache-write price and inactive routes", async t => {
  const data = fixture();
  const draft = data.settings.versions[0].payload;
  const rate = draft.rates.models.find(row => row.provider === "riic-gpt");
  rate.cacheWrite = "1.25"; rate.peak.cacheWrite = "2.5";
  rate.longContext = { inputTokenThreshold: 272000, input: "6", cachedInput: "0.06", cacheWrite: "3.75", output: "13.5", peak: { input: "10", cachedInput: "0.1", cacheWrite: "5", output: "18" } };
  draft.rates.models.push({ provider: "riic-deepseek-official", model: "deepseek-flash", currency: "RMB", exchangeRate: "1", input: "1", cachedInput: "0.02", cacheWrite: "0.4", output: "4", peak: { input: "2", cachedInput: "0.04", cacheWrite: "0.8", output: "8" } });
  const { renderer } = await mount(t, data);
  await change(field(renderer.root, "变更原因"), "inspect saved cache-write rates");
  await click(button(renderer.root, "发布"));
  const snapshot = renderer.root.findByProps({ "data-model-settings-snapshot": true });
  const prices = snapshot.findAllByType("dt").filter(node => /^(高峰 · )?缓存写入$/.test(text(node))).map(node => text(node.parent.findByType("dd")));
  assert.deepEqual(prices, ["1.25", "2.5", "3.75", "5", "0.4", "0.8"]);
  assert.match(text(snapshot), /未单独计算缓存写入/);
});
