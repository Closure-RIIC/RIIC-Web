import assert from "node:assert/strict";
import test from "node:test";
import { DOC_ARTICLES, DOC_GROUPS, findDoc, searchDocs } from "./content.ts";
import { legacyImportDestination, legacyIssueDestination } from "./legacy-help.ts";

test("documentation navigation has unique destinations, headings, and valid related articles", () => {
  assert.equal(new Set(DOC_ARTICLES.map(item => item.slug)).size, DOC_ARTICLES.length);
  assert.equal(DOC_ARTICLES[0].slug, "first-import");
  for (const article of DOC_ARTICLES) {
    assert.ok(DOC_GROUPS.some(group => group.id === article.group));
    assert.equal(new Set(article.sections.map(section => section.id)).size, article.sections.length);
    for (const slug of article.related ?? []) assert.ok(findDoc(slug), `${article.slug} links to ${slug}`);
    assert.ok(article.title.every(Boolean) && article.description.every(Boolean));
  }
});

test("search finds answers in both languages and favors matching article titles", () => {
  assert.equal(searchDocs("  MAA 文件导入  ", "zh")[0]?.slug, "maa-import");
  assert.ok(searchDocs("Arknights_OperBox_Export.json", "zh").some(article => article.slug === "maa-import"));
  assert.equal(searchDocs("Skland sync fails", "en")[0]?.slug, "faq-sync");
  assert.ok(searchDocs("无人机", "en").some(article => article.slug === "drones"));
  assert.deepEqual(searchDocs("no-such-document-198237", "en"), []);
});

test("legacy import links retain their selected source and step without accepting invalid input", () => {
  assert.deepEqual(legacyImportDestination({ step: "4", source: "maa" }), { slug: "first-import", hash: "import-methods", source: "maa" });
  assert.equal(legacyImportDestination({ step: "999" }).hash, "finish");
  assert.equal(legacyImportDestination({ step: "invalid", source: "unknown" }).hash, "open-settings");
  assert.equal(legacyImportDestination({ source: "unknown" }).source, undefined);
  assert.equal(legacyIssueDestination("unexpected-operators"), "faq-box");
  assert.equal(legacyIssueDestination("box-not-applied"), "faq-box-not-applied");
  assert.equal(legacyIssueDestination("__proto__"), "faq");
});
