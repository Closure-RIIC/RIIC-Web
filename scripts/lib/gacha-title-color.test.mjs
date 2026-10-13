import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import sharp from "sharp";
import { extractTitleAccent } from "./gacha-title-color.mjs";

const png = (pixels) => sharp(Buffer.from(pixels.flat()), { raw: { width: pixels.length, height: 1, channels: 4 } }).png().toBuffer();

test("transparent pixels and white backgrounds do not override the title color", async () => {
  const image = await png([[255, 0, 0, 0], [255, 255, 255, 255], [255, 255, 255, 255], [30, 160, 220, 255]]);
  assert.equal(await extractTitleAccent([image]), "#1ea0dc");
});

test("monochrome and empty artwork use the theme fallback", async () => {
  assert.equal(await extractTitleAccent([await png([[255, 255, 255, 255], [90, 90, 90, 255], [0, 0, 0, 255]])]), null);
  assert.equal(await extractTitleAccent([]), null);
});

test("composite titles include colored foreground layers and discount faint shadows", async () => {
  const backdrop = await png(Array.from({ length: 8 }, () => [255, 255, 255, 255]));
  const shadow = await png(Array.from({ length: 8 }, () => [0, 255, 0, 40]));
  const letters = await png([[240, 100, 40, 255], [240, 100, 40, 255]]);
  assert.equal(await extractTitleAccent([backdrop, shadow, letters]), "#f06428");
});
