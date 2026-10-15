import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import sharp from "sharp";

const repoRoot = new URL("../", import.meta.url);

async function assertPng(relativePath, expectedSize) {
  const contents = await readFile(new URL(relativePath, repoRoot));
  const metadata = await sharp(contents).metadata();

  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, expectedSize);
  assert.equal(metadata.height, expectedSize);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.channels, 4);
}

test("site icon PNG files have the dimensions required by the website and Apple devices", async () => {
  await assertPng("assets/branding/closure-site-icon.png", 1024);
  await assertPng("src/app/icon.png", 512);
  await assertPng("src/app/apple-icon.png", 180);
});

test("favicon.ico contains transparent PNG entries for common browser sizes", async () => {
  const favicon = await readFile(new URL("public/favicon.ico", repoRoot));
  const expectedSizes = [16, 32, 48, 64, 128, 256];

  assert.equal(favicon.readUInt16LE(0), 0);
  assert.equal(favicon.readUInt16LE(2), 1);
  assert.equal(favicon.readUInt16LE(4), expectedSizes.length);

  for (const [index, expectedSize] of expectedSizes.entries()) {
    const directoryOffset = 6 + index * 16;
    const encodedSize = expectedSize === 256 ? 0 : expectedSize;
    assert.equal(favicon.readUInt8(directoryOffset), encodedSize);
    assert.equal(favicon.readUInt8(directoryOffset + 1), encodedSize);
    assert.equal(favicon.readUInt16LE(directoryOffset + 4), 1);
    assert.equal(favicon.readUInt16LE(directoryOffset + 6), 32);

    const imageLength = favicon.readUInt32LE(directoryOffset + 8);
    const imageOffset = favicon.readUInt32LE(directoryOffset + 12);
    assert.ok(imageLength > 0);
    assert.ok(imageOffset + imageLength <= favicon.length);

    const metadata = await sharp(
      favicon.subarray(imageOffset, imageOffset + imageLength),
    ).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, expectedSize);
    assert.equal(metadata.height, expectedSize);
    assert.equal(metadata.hasAlpha, true);
  }
});
