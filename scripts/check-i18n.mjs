import assert from "node:assert/strict";
import fs from "node:fs";
import { log } from "node:console";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "use-intl/core";

const locales = ["zh", "en"];
const catalogs = Object.fromEntries(locales.map((locale) => {
  const messages = JSON.parse(fs.readFileSync(`apps/arknights/messages/${locale}.json`, "utf8"));
  for (const directory of [`apps/arknights/messages/helpers/${locale}`, `packages/arknights-domain/messages/helpers/${locale}`]) {
  for (const file of fs.readdirSync(directory)) {
    if (!file.endsWith(".json")) continue;
    const namespace = file.replace(/\.json$/, "");
    assert.ok(!(namespace in messages), `Duplicate namespace: ${namespace}`);
    messages[namespace] = JSON.parse(fs.readFileSync(`${directory}/${file}`, "utf8"));
  }
  }
  return [locale, messages];
}));
function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, item]) => typeof item === "string"
    ? [[prefix + key, item]]
    : flatten(item, `${prefix}${key}.`));
}

function sampleValues(nodes, values = {}) {
  for (const node of nodes) {
    switch (node.type) {
      case TYPE.argument: values[node.value] = "sample"; break;
      case TYPE.number:
      case TYPE.plural: values[node.value] = 2; break;
      case TYPE.date:
      case TYPE.time: values[node.value] = new Date("2026-01-01T00:00:00Z"); break;
      case TYPE.select: values[node.value] = "yes"; break;
      case TYPE.tag:
        values[node.value] = (chunks) => chunks;
        sampleValues(node.children, values);
        break;
    }
    if (node.options) {
      for (const option of Object.values(node.options)) sampleValues(option.value, values);
    }
  }
  return values;
}

const flattened = Object.fromEntries(locales.map((locale) => [locale, flatten(catalogs[locale])]));
assert.deepEqual(
  flattened.en.map(([key]) => key).sort(),
  flattened.zh.map(([key]) => key).sort(),
  "Locale message keys must match",
);
for (const locale of locales) {
  const translate = createTranslator({ locale, messages: catalogs[locale], onError(error) { throw error; } });
  for (const [key, message] of flattened[locale]) {
    try {
      translate.rich(key, sampleValues(parse(message)));
    } catch (error) {
      throw new Error(`${locale}:${key}: ${error.message}`, { cause: error });
    }
  }
}

const records = Object.fromEntries(locales.map((locale) => [
  locale, JSON.parse(fs.readFileSync(`apps/arknights/messages/records/${locale}.json`, "utf8")),
]));
assert.deepEqual(
  flatten(records.en).map(([key]) => key).sort(),
  flatten(records.zh).map(([key]) => key).sort(),
  "Structured presentation keys must match",
);
log(`Validated ${flattened.zh.length} message keys and structured presentation records in both locales.`);

const authCatalogs = Object.fromEntries(locales.map(locale => [locale, JSON.parse(fs.readFileSync(`packages/shell/auth/${locale}.json`, "utf8"))]));
const authRecords = Object.fromEntries(locales.map(locale => [locale, JSON.parse(fs.readFileSync(`packages/shell/auth/${locale}-records.json`, "utf8"))]));
for (const catalogs of [authCatalogs, authRecords]) {
  assert.deepEqual(flatten(catalogs.en).map(([key]) => key).sort(), flatten(catalogs.zh).map(([key]) => key).sort(), "Shared account locale keys must match");
}
for (const locale of locales) {
  const translate = createTranslator({ locale, messages: authCatalogs[locale], onError(error) { throw error; } });
  for (const [key, message] of flatten(authCatalogs[locale])) translate.rich(key, sampleValues(parse(message)));
}
log("Validated shared account dialog messages in both locales.");
