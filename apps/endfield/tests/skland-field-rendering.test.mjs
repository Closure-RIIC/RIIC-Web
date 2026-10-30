import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { pageNamespaces } from "../src/i18n/feature-manifest.ts";
import { loadMessages } from "../src/i18n/messages.ts";

const root = path.resolve(import.meta.dirname, "../../..");
await fs.mkdir(path.join(root, ".tmp"), { recursive: true });
const directory = await fs.mkdtemp(path.join(root, ".tmp/skland-field-rendering-"));
after(() => fs.rm(directory, { recursive: true, force: true }));
const outfile = path.join(directory, "fields.mjs");
await build({
  stdin: { contents: "export { DataFields } from './apps/endfield/src/components/SklandDataView';", resolveDir: root },
  bundle: true, platform: "node", format: "esm", jsx: "automatic", outfile,
  external: ["react", "react/jsx-runtime", "react-dom", "use-intl", "use-intl/core", "@riic/arknights-domain/i18n/localize"],
  loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
});
const { DataFields } = await import(pathToFileURL(outfile));

test("expanded operator equipment and nested skill fields render in the selected language", async () => {
  const value = {
    id: "char_levatine", level: 90, userSkills: [{ skillId: "skill_1", skillLevel: 3 }],
    bodyEquip: { level: 50 }, armEquip: { level: 50 },
    firstAccessory: { level: 50 }, secondAccessory: { level: 50 },
  };
  for (const locale of ["zh-CN", "zh-TW", "en"]) {
    const messages = await loadMessages(locale, pageNamespaces("/skland"));
    assert.ok(messages.SklandFields, `${locale}: route must load the field catalog`);
    const render = data => renderToStaticMarkup(createElement(IntlProvider, {
      locale, messages, timeZone: "Asia/Shanghai", onError: error => { throw error; },
    }, createElement(DataFields, { value: data, names: new Map([["char_levatine", "Laevatain"]]) })));
    const markup = render(value);
    assert.doesNotMatch(markup, /SklandFields\.|SklandDataView\./);
    for (const key of Object.keys(value)) assert.ok(markup.includes(messages.SklandFields[key]), `${locale}: ${key}`);
    for (const data of [value.userSkills[0], value.bodyEquip, value.armEquip, value.firstAccessory, value.secondAccessory]) {
      const nested = render(data);
      for (const key of Object.keys(data)) assert.ok(nested.includes(messages.SklandFields[key]), `${locale}: nested ${key}`);
    }
  }
});

test("every supported detail field renders a translated label from route resources", async () => {
  for (const locale of ["zh-CN", "zh-TW", "en"]) {
    const messages = await loadMessages(locale, pageNamespaces("/skland"));
    const fields = messages.SklandFields;
    const value = Object.fromEntries(Object.keys(fields).map(key => [key, null]));
    const markup = renderToStaticMarkup(createElement(IntlProvider, {
      locale, messages, timeZone: "Asia/Shanghai", onError: error => { throw error; },
    }, createElement(DataFields, { value, names: new Map() })));
    assert.doesNotMatch(markup, /SklandFields\.|SklandDataView\./);
    for (const [key, label] of Object.entries(fields)) {
      assert.ok(markup.includes(renderToStaticMarkup(createElement("dt", null, label))), `${locale}: ${key}`);
    }
  }
});

test("skill dictionary keys use readable names or localized ordinals rather than internal hashes", async () => {
  const ids = ["166d38ccfe9f7486047e9721e7d6adde", "3299d991a0f8417c245adc2997263ae6", "b2c072b0b15f8157f0b11da1c955de74", "ff40dad4b22b95c4a2a765bd6b4f2d8e"];
  const value = Object.fromEntries(ids.map(id => [id, { level: 1, skillLevel: 1 }]));
  const before = structuredClone(value);
  for (const locale of ["zh-CN", "zh-TW", "en"]) {
    const messages = await loadMessages(locale, pageNamespaces("/skland"));
    const render = (data, field = "userSkills") => renderToStaticMarkup(createElement(IntlProvider, {
      locale, messages, timeZone: "Asia/Shanghai", onError: error => { throw error; },
    }, createElement(DataFields, { value: data, names: new Map(), field })));
    const markup = render(value);
    for (const id of ids) assert.ok(!markup.includes(id));
    for (let index = 1; index <= ids.length; index++) {
      const label = messages.SklandDataView.skillEntry.replace("{index}", String(index));
      assert.ok(markup.includes(`<dt>${label}</dt>`), `${locale}: skill ${index}`);
    }
    assert.ok(render({ [ids[0]]: { name: "Named skill", level: 1 } }).includes("<dt>Named skill</dt>"));
    assert.ok(render({ [ids[0]]: { skillData: { name: "Nested skill" } } }).includes("<dt>Nested skill</dt>"));
    assert.ok(!render(value, "equipData").includes(ids[0]));
  }
  assert.deepEqual(value, before);
});
