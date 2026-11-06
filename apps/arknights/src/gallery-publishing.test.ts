import test from "node:test";
import assert from "node:assert/strict";
import { gallerySamples, galleryOperators } from "./schedule-gallery.ts";
import { OPERATOR_CATALOG, operatorFor } from "./operator-catalog.ts";
import { applyGalleryAlternatives, compareGalleryBox, parseGallerySubmission } from "./gallery-publishing.ts";

function training(name: string, elite = 2, level = 50) {
  const operator = operatorFor(name)!;
  return { id: operator.id, name, elite, level, potential: 1, rarity: operator.rarity, own: true };
}
test("roster comparison separates missing operators, training gaps and whole-roster differences", () => {
  const doc = structuredClone(gallerySamples()[0]!.document);
  const [first, second, third] = galleryOperators(doc);
  const extra = OPERATOR_CATALOG.find(operator => !galleryOperators(doc).includes(operator.name))!.name;
  doc.operators = [training(first!, 2, 60)];
  const author = [training(first!), training(second!), training(third!)];
  const viewer = [training(first!, 1, 80), training(second!), training(extra)];
  const result = compareGalleryBox(doc, viewer, author);
  assert.equal(result.common, 2);
  assert.deepEqual(result.authorOnly, [third]);
  assert.deepEqual(result.viewerOnly, [extra]);
  assert.equal(result.lowerTraining[0]?.name, first);
  assert.ok(result.missing.includes(third!));
  assert.ok(!result.missing.includes(first!));
});
test("author alternatives are validated and cannot cause double assignment or change the source", () => {
  const doc = gallerySamples()[0]!.document;
  const names = galleryOperators(doc);
  const first = names[0]!;
  const available = OPERATOR_CATALOG.find(operator => !names.includes(operator.name))!.name;
  const source = { document: doc, notes: "test", alternatives: { [first]: [available] } };
  const replaced = applyGalleryAlternatives(source, { [first]: available }, [training(available)]);
  assert.ok(galleryOperators(replaced).includes(available));
  assert.ok(galleryOperators(doc).includes(first));
  assert.throws(() => applyGalleryAlternatives(source, { [first]: names[1]! }, []));
  assert.throws(() => applyGalleryAlternatives({ ...source, alternatives: { [first]: [names[1]!] } }, { [first]: names[1]! }, []));
  assert.throws(() => parseGallerySubmission({ ...source, alternatives: { [first]: ["not-an-operator"] } }));
});
test("full author roster is opt-in and non-owned entries do not leak into the snapshot", () => {
  const doc = gallerySamples()[0]!.document;
  const name = galleryOperators(doc)[0]!;
  assert.equal(parseGallerySubmission({ document: doc }).authorBox, undefined);
  assert.deepEqual(parseGallerySubmission({ document: doc, authorBox: [{ ...training(name), own: false }] }).authorBox, []);
});
