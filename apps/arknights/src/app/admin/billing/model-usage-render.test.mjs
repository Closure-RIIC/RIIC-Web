import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { registerMessages } from "@riic/arknights-domain/i18n/localize";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const locales = ["zh-CN", "zh-TW", "en"];
const messages = {};
let temporary;
let compiled;

before(async () => {
  for (const locale of locales) {
    messages[locale] = { Admin_billing_console: JSON.parse(await readFile(path.join(root, `messages/${locale}/Admin_billing_console.json`), "utf8")) };
    registerMessages(locale, messages[locale]);
  }
  temporary = await mkdtemp(path.join(root, ".model-usage-render-test-"));
  const outfile = path.join(temporary, "usage.mjs");
  await build({
    stdin: { contents: `
      export { ModelUsageSummary } from "./src/app/admin/billing/model-usage-summary.tsx";
      export { ModelCallDetail } from "./src/app/admin/billing/model-call-detail.tsx";
    `, resolveDir: root, sourcefile: "model-usage-render-entry.tsx", loader: "tsx" },
    outfile, bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
    alias: { "@": path.join(root, "src") },
  });
  compiled = await import(pathToFileURL(outfile).href);
});

after(async () => {
  if (temporary) {
    const relative = path.relative(root, path.resolve(temporary));
    assert.ok(relative.startsWith(".model-usage-render-test-") && !relative.includes(path.sep));
    await rm(temporary, { recursive: true, force: true });
  }
});

const render = (Component, props, locale = "zh-CN") => renderToStaticMarkup(React.createElement(IntlProvider,
  { locale, messages: messages[locale], timeZone: "Asia/Shanghai" }, React.createElement(Component, props)));
const cells = markup => [...markup.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1].replace(/<[^>]*>/g, ""));
const ungroup = value => value.replace(/[,\u00a0\u202f]/g, "");
const row = overrides => ({
  modelId: "gpt", label: "GPT fixture", provider: "riic-gpt", model: "gpt-fixture",
  calls: 3, inputTokens: "9007199254740993", cachedInputTokens: null, cacheWriteTokens: null, outputTokens: "0",
  knownUpstreamRmb: null, knownChargedRmb: "0", longContextCalls: 1,
  unknownUsageCalls: 2, unknownCostCalls: 1, pendingReviewCalls: 1, ...overrides,
});

test("model summaries preserve bigint tokens and distinguish unknown usage and money from zero in every locale", () => {
  for (const locale of locales) {
    const markup = render(compiled.ModelUsageSummary, { rows: [row()] }, locale);
    const values = cells(markup);
    assert.equal(ungroup(values[2]), "9007199254740993");
    assert.equal(values[3], messages[locale].Admin_billing_console.unknownNone);
    assert.equal(values[4], messages[locale].Admin_billing_console.cacheWriteNotRecorded);
    assert.equal(values[5], "0");
    assert.equal(values[6], messages[locale].Admin_billing_console.unknownNone);
    assert.equal(Number(ungroup(values[7])), 0);
    assert.match(markup, new RegExp(messages[locale].Admin_billing_console.statPriced));
    assert.doesNotMatch(markup, /NaN|undefined/);
  }
});

test("known model amounts retain eight displayed decimal places without binary-number precision loss", () => {
  const values = cells(render(compiled.ModelUsageSummary, { rows: [row({
    knownUpstreamRmb: "123456789012.12345678", knownChargedRmb: "987654321098.87654321",
  })] }));
  assert.equal(ungroup(values[6]), "123456789012.12345678");
  assert.equal(ungroup(values[7]), "987654321098.87654321");
});

test("call details display both price tiers and preserve original decimal strings and unknowns", () => {
  const markup = render(compiled.ModelCallDetail, { detail: { calls: [
    { id: "base-call", provider: "riic-gpt", model: "gpt-fixture", input_tokens: 272000, cached_input_tokens: 100, cache_write_tokens: 0, output_tokens: 0, upstream_rmb: "0.123456789012", charged_rmb: "0.148148146814", pricing_tier: "base" },
    { id: "long-call", provider: "riic-gpt", model: "gpt-fixture", input_tokens: 272001, cached_input_tokens: 100, cache_write_tokens: 12, output_tokens: 2, upstream_rmb: "1.234567890123", charged_rmb: "1.481481468148", pricing_tier: "long-context" },
    { id: "unknown-call", provider: null, model: null, input_tokens: null, cached_input_tokens: null, output_tokens: null, upstream_rmb: null, charged_rmb: null, pricing_tier: null },
  ] } });
  const values = cells(markup);
  assert.equal(values.length, 21);
  assert.match(values[0], /基础档/);
  assert.match(values[7], /长上下文档/);
  assert.equal(values[5], "0.123456789012");
  assert.equal(values[12], "1.234567890123");
  assert.equal(values[3], "0");
  assert.equal(values[10], "12");
  assert.equal(values[17], "未记录");
  assert.equal(values[15], "未知 / 无");
  assert.equal(values[19], "未知 / 无");
  assert.match(markup, /已知计价金额/);
  assert.doesNotMatch(markup, /已扣积分/);
});

test("gateway detail attributes usage and costs to the whole related call rather than the attempt", () => {
  const markup = render(compiled.ModelCallDetail, { detail: {
    provider: "attempt-provider", model: "attempt-model", input_tokens: 999, upstream_rmb: "999.99",
    related_call: { id: "related-call", status: "measured", provider: "riic-gpt", model: "actual-call-model", inputTokens: 123, cachedInputTokens: 12, cacheWriteTokens: 7, outputTokens: 4, upstreamRmb: "0.333333333333", chargedRmb: "0.4", pricingTier: "base" },
  } });
  const values = cells(markup);
  assert.match(values[0], /riic-gpt \/ actual-call-model/);
  assert.equal(values[1], "123");
  assert.equal(values[3], "7");
  assert.equal(values[5], "0.333333333333");
  assert.match(markup, /关联整次调用/);
  assert.doesNotMatch(markup, /attempt-model|999\.99/);
});

test("unlinked gateway requests do not fabricate a model call or zero-cost detail", () => {
  assert.equal(render(compiled.ModelCallDetail, { detail: { provider: "riic-gpt", model: "gpt-fixture", related_call: null, upstream_rmb: "9" } }), "");
});

test("cache-write totals distinguish missing history, explicit zero and precise large totals in all locales", () => {
  for (const locale of locales) {
    for (const value of [undefined, null, "0", "9007199254740993"]) {
      const values = cells(render(compiled.ModelUsageSummary, { rows: [row({ cacheWriteTokens: value })] }, locale));
      assert.equal(ungroup(values[4]), value == null ? messages[locale].Admin_billing_console.cacheWriteNotRecorded : value);
    }
    for (const value of [undefined, null, 0, 12]) {
      const detail = { calls: [{ id: "history", provider: "riic-deepseek", model: "legacy", cache_write_tokens: value }] };
      assert.equal(cells(render(compiled.ModelCallDetail, { detail }, locale))[3], value == null ? messages[locale].Admin_billing_console.cacheWriteNotRecorded : String(value));
    }
  }
});
