import assert from "node:assert/strict";
import test from "node:test";
import { scanHelpers } from "./x18n-scanner.mjs";

const scan = text => scanHelpers({ path: "apps/arknights/src/fixture.ts", text }, process.cwd()).usages;
test("ref and typed translator calls preserve namespaces and lexical scope", () => {
  const result = scan(`function first() {
    const t = useTranslations("Common"); const latest = useRef(t);
    latest.current("requestFailed");
    const state = useRef({ t }); state.current.t("language");
  }
  function second() { const t = useTranslations("TrainingPlanner"); t("lmd"); }
  function label(translate: ReturnType<typeof useTranslations<"TrainingPlanner">>) { translate("redGold"); }`);
  assert.deepEqual(result.map(item => item.raw), ["Common.requestFailed", "Common.language", "TrainingPlanner.lmd", "TrainingPlanner.redGold"]);
});
test("explicit-locale helpers resolve conditional keys, aliases and invalid keys", () => {
  const result = scan(`import { localize as words } from "./i18n/helpers/Common.ts";
    words.text(locale, flag ? "cancel" : "deliberatelyInvalid");
    words.rich(locale, "title");`);
  assert.deepEqual(result.map(item => item.raw), ["Common.cancel", "Common.deliberatelyInvalid", "Common.title"]);
  assert.ok(result.every(item => item.dynamic === false));
});
test("finite data maps preserve missing keys; unknown calls do not mark a namespace used", () => {
  const result = scan(`const labels = { a: "Metadata.manual", b: "Metadata.deliberatelyInvalid" };
    const words = createLocalizer("Common");
    words.text(locale, fromNetwork);`);
  assert.deepEqual(result.map(item => [item.raw, item.dynamic]), [["Metadata.manual", false], ["Metadata.deliberatelyInvalid", false], ["Common", "unknown"]]);
});
test("structured records mark only the accessed record subtree", () => {
  const result = scan(`messageRecord(locale, "options"); getCatalog(locale, "records");`);
  assert.deepEqual(result.map(item => [item.raw, item.dynamic]), [["records.options", "prefix"]]);
});

test("typed component props enumerate their declared keys without consulting catalogs", () => {
  const result = scan(`type Label = { title: "cancel" | "deliberatelyInvalid" };
    function Card({ item }: { item: Label }) {
      const words = useTranslations("Common"); words(item.title);
    }`);
  assert.deepEqual(result.map(item => item.raw), ["Common.cancel", "Common.deliberatelyInvalid"]);
  assert.ok(result.every(item => item.dynamic === false));
});

test("a filtered navigation factory and destructured tuples retain finite references", () => {
  const result = scan(`const nav = [{ title: "cancel" }, { title: "deliberatelyInvalid" }];
    function navigation() { return nav.filter(item => item); }
    const items = navigation(); const words = useTranslations("Common");
    items.map(item => words(item.title));
    const rows = [["cancel", 1], ["deliberatelyInvalid", 2]] as const;
    rows.map(([label]) => words(label));`);
  assert.deepEqual(result.map(item => item.raw), ["Common.cancel", "Common.deliberatelyInvalid", "Common.cancel", "Common.deliberatelyInvalid"]);
});
