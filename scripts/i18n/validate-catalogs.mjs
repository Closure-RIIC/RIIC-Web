import fs from "node:fs";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "use-intl/core";
import { icu } from "./icu.mjs";

const locales = ["zh-CN", "zh-TW", "en"];
const roots = ["apps/arknights/messages", "apps/endfield/messages", "packages/shell/messages", "packages/arknights-domain/messages"];
const structured = new Set(["records", "AccountRecords", "AgentPersonas"]);
const issues = [];
let count = 0;
function flatten(value, prefix = "") {
  if (typeof value === "string") return [[prefix, value]];
  if (!value || typeof value !== "object") throw new Error(`Invalid resource value at ${prefix}`);
  return Object.entries(value).flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key));
}
function sampleValues(nodes, values = {}) {
  for (const node of nodes) {
    if (node.type === TYPE.argument) values[node.value] = "sample";
    if ([TYPE.number, TYPE.plural].includes(node.type)) values[node.value] = 2;
    if ([TYPE.date, TYPE.time].includes(node.type)) values[node.value] = new Date("2026-01-01T00:00:00Z");
    if (node.type === TYPE.select) values[node.value] = "other";
    if (node.type === TYPE.tag) { values[node.value] = chunks => chunks; sampleValues(node.children, values); }
    if (node.options) for (const option of Object.values(node.options)) sampleValues(option.value, values);
  }
  return values;
}
for (const root of roots) {
  const files = Object.fromEntries(locales.map(locale => [locale, fs.readdirSync(`${root}/${locale}`).filter(file => file.endsWith(".json")).sort()]));
  for (const locale of locales) if (JSON.stringify(files[locale]) !== JSON.stringify(files["zh-CN"])) issues.push(`${root}/${locale}: namespace set differs`);
  for (const file of files["zh-CN"]) {
    const namespace = file.slice(0, -5);
    const catalogs = Object.fromEntries(locales.map(locale => [locale, JSON.parse(fs.readFileSync(`${root}/${locale}/${file}`, "utf8"))]));
    const leaves = Object.fromEntries(locales.map(locale => [locale, new Map(flatten(catalogs[locale]))]));
    const keys = [...leaves["zh-CN"].keys()].sort(); count += keys.length;
    for (const locale of locales) {
      if (JSON.stringify([...leaves[locale].keys()].sort()) !== JSON.stringify(keys)) issues.push(`${root}/${locale}/${file}: key or structured-record shape differs`);
      const translate = structured.has(namespace) ? null : createTranslator({ locale, messages: catalogs[locale], onError(error) { throw error; } });
      for (const [key, value] of leaves[locale]) {
        try {
          if (translate) {
            translate.rich(key, sampleValues(parse(value)));
            const signature = text => [...new Set(icu.find(text).map(token => token.name))].sort().join("|");
            if (signature(value) !== signature(leaves["zh-CN"].get(key) ?? "")) throw new Error("ICU arguments or rich-text tags differ");
          }
        } catch (error) { issues.push(`${root}/${locale}/${file}:${key}: ${error.message}`); }
      }
    }
  }
}
if (issues.length) { console.error(issues.join("\n")); process.exitCode = 1; }
else console.log(`Validated ${count} UI/record keys across both applications and shared packages in ${locales.join(", ")}.`);
