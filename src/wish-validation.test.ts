import assert from "node:assert/strict";
import test from "node:test";
import { parseWishInput } from "./wish-validation.ts";

test("wish submissions validate text and allow only bounded raster data URLs", () => {
  assert.deepEqual(parseWishInput({ title: " title ", content: " body " }), { title: "title", content: "body", imageUrls: [] });
  const image = "data:image/png;base64,iVBORw0KGgo=";
  assert.ok(parseWishInput({ title: "x", content: "x", imageUrls: [image] }));
  for (const value of [null, [], {}, { title: " ", content: "x" }, { title: "x".repeat(121), content: "x" },
    { title: "x", content: "x".repeat(5001) },
    ...["https://example.test/a.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,???", image.repeat(100_000)].map(image => ({ title: "x", content: "x", imageUrls: [image] })),
    { title: "x", content: "x", imageUrls: Array(5).fill(image) }]) {
    assert.equal(parseWishInput(value), null);
  }
});
