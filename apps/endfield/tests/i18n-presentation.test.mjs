import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createTranslator } from "use-intl/core";
import { StepSimulation } from "../src/step/step-engine.ts";

// Bundle only the pure presentation functions to resolve Vite-style JSON imports.
const root = path.resolve(import.meta.dirname, "../../..");
await fs.mkdir(path.join(root, ".tmp"), { recursive: true });
const directory = await fs.mkdtemp(path.join(root, ".tmp/i18n-presentation-"));
after(() => fs.rm(directory, { recursive: true, force: true }));
const outfile = path.join(directory, "presentation.mjs");
await build({ stdin: { contents: `
  export { stepLogText, stepProblemText } from './apps/endfield/src/step/step-presentation';
  export { solverMessage } from './apps/endfield/src/result-presentation';
  export { sklandErrorKey, SklandFeedbackError } from './apps/endfield/src/skland-feedback';
  export { sklandFeedbackText } from './apps/endfield/src/skland-feedback-text';
  export { PlatformRequestError } from './packages/platform/client';
  export { registerMessages } from './packages/arknights-domain/src/i18n/localize';
`, resolveDir: root }, bundle: true, platform: "node", format: "esm", external: ["use-intl/core"], outfile });
const { stepLogText, stepProblemText, solverMessage, sklandErrorKey, SklandFeedbackError, sklandFeedbackText, PlatformRequestError, registerMessages } = await import(pathToFileURL(outfile));
const translators = {};
for (const locale of ["zh-CN", "zh-TW", "en"]) {
  const messages = {};
  for (const namespace of ["StepMessages", "Game", "ReportMessages", "SklandErrors", "Skland", "SklandLoginPanel", "SklandDataView", "SklandInventory", "SklandProgress", "SklandSyncDetails", "SklandFields"]) {
    messages[namespace] = JSON.parse(await fs.readFile(path.join(root, `apps/endfield/messages/${locale}/${namespace}.json`), "utf8"));
  }
  messages.EndfieldGameData = JSON.parse(await fs.readFile(path.join(root, `packages/endfield-data/messages/${locale}/EndfieldGameData.json`), "utf8"));
  registerMessages(locale, messages);
  translators[locale] = createTranslator({ locale, messages, onError: error => { throw error; } });
}

test("Skland page labels and existing sync errors follow the selected language", async () => {
  const keys = new Set();
  for (const name of ["SklandPage", "SklandLoginPanel", "SklandDataView", "SklandInventory", "SklandProgress", "SklandSyncDetails"]) {
    const source = await fs.readFile(path.join(root, `apps/endfield/src/components/${name}.tsx`), "utf8");
    for (const match of source.matchAll(/"(Skland\w*\.[A-Za-z]+)"/g)) keys.add(match[1]);
    if (name === "SklandDataView") {
      const fields = JSON.parse(source.match(/const detailFieldKeys = new Set\((\[[^\n]+\])\);/)[1]);
      for (const field of fields) keys.add(`SklandFields.${field}`);
    }
  }
  const error = new PlatformRequestError("untranslated upstream error");
  error.status = 401;
  const key = sklandErrorKey(error, "Skland.syncFailedPleaseRetry");
  const feedback = new Set();
  for (const [locale, t] of Object.entries(translators)) {
    for (const key of keys) {
      const text = t(key);
      assert.ok(text && text !== key, `${locale}: ${key}`);
    }
    const text = sklandFeedbackText(key, t);
    assert.doesNotMatch(text, /SklandErrors\.|untranslated upstream/);
    feedback.add(text);
  }
  assert.equal(feedback.size, 3, "the same stored error renders in all three languages");
});

test("existing simulation events and validation problems switch languages without changing simulation state", () => {
  const simulation = new StepSimulation({
    rooms: [{ key: "会客室", label: "会客室", kind: "guest", slots: 1, hour: 12, single: true,
      products: ["线索"], enabled: true, crewA: ["佩丽卡"], crewB: [null] }],
    moods: { 佩丽卡: 20 }, work: {},
    boost: { dailyCount: 1, currentDay: 0, days: [{ list: [{ hour: 1, minute: 0, target: "佩丽卡" }] }] },
  }, () => ({ reduce: 0, restore: 0, effMap: {} }), { work: 0.072, rest: 0.12, head: 0.4, assist: 0.3 }, { startHour: 0, maxHours: 24, sampleSec: 60 });
  simulation.runToEnd();
  const before = structuredClone(simulation.view);
  for (const [locale, t] of Object.entries(translators)) {
    const logs = simulation.view.log.map(entry => stepLogText(entry.message, locale, t));
    assert.ok(logs.every(text => text.length > 0));
    const boost = logs[simulation.view.log.findIndex(entry => entry.message.kind === "boost")];
    assert.match(boost, /30/);
    if (locale === "en") {
      assert.match(boost, /Perlica/);
      assert.doesNotMatch(logs.join("\n"), /\p{Script=Han}/u);
      assert.match(stepProblemText({ kind: "duplicate-operator", name: "佩丽卡" }, locale, t), /Perlica.*more than once/);
    } else if (locale === "zh-TW") {
      assert.match(stepProblemText({ kind: "invalid-hour", room: "制造舱1" }, locale, t), /製造/);
    }
  }
  assert.deepEqual(simulation.view, before);
});

test("report diagnostics translate nested assignments, quantities, categories and output grades", () => {
  const t = translators.en;
  assert.match(solverMessage("干员「佩丽卡」同时在 中枢/A 与 制造舱1/B 技能人员", "en", t), /Perlica.*Control center\/A.*Manufacturing I\/B skilled operators/);
  assert.equal(solverMessage("可用 2 人，满工位最少需要 6 人", "en", t), "2 operators available; at least 6 are needed to fill all slots");
  assert.equal(solverMessage("金色菌类", "en", t), "Gold Fungi");
  assert.match(solverMessage("类别「武器经验」独立重算 12.100000 与记录 24.000000 不一致", "en", t), /Weapon EXP.*12.100000.*24.000000/);
  assert.doesNotMatch(solverMessage("同类双设施缺少稳定实例，按上界估计", "en", t), /\p{Script=Han}/u);
  assert.equal(solverMessage("future diagnostic 123", "en", t), "future diagnostic 123", "unknown diagnostics remain available for investigation");
});

test("request errors use stable translated codes and never display untrusted exception text", () => {
  const error = new PlatformRequestError("private upstream detail");
  error.status = 401; error.code = "AIC-AUTH-2008";
  const key = sklandErrorKey(error, "SklandErrors.unavailable");
  assert.equal(key, "SklandErrors.signInRequired");
  for (const t of Object.values(translators)) assert.doesNotMatch(t(key), /private|SklandErrors/);
  error.status = 429; error.code = "toString";
  assert.equal(sklandErrorKey(error, "SklandErrors.unavailable"), "SklandErrors.rateLimited");
  assert.equal(sklandErrorKey(new Error("secret"), "SklandErrors.unavailable"), "SklandErrors.unavailable");
  assert.equal(sklandErrorKey(new SklandFeedbackError("SklandErrors.roleMismatch"), "SklandErrors.unavailable"), "SklandErrors.roleMismatch");
});
