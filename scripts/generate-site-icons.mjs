import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import sharp from "sharp";

const repoRoot = new URL("../", import.meta.url);
const masterUrl = new URL("assets/branding/closure-site-icon.png", repoRoot);
const outputDefinitions = [
  { url: new URL("public/icon.png", repoRoot), size: 512 },
  { url: new URL("public/apple-icon.png", repoRoot), size: 180 },
  { url: new URL("src/app/icon.png", repoRoot), size: 512 },
  { url: new URL("src/app/apple-icon.png", repoRoot), size: 180 },
];
const faviconUrl = new URL("public/favicon.ico", repoRoot);
const faviconSizes = [16, 32, 48, 64, 128, 256];

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  if (index === args.length - 1) {
    throw new Error(`${name} requires a path`);
  }
  return args[index + 1];
}

async function renderPng(source, size) {
  return sharp(source)
    .resize({
      width: size,
      height: size,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

function packageIco(entries) {
  const headerSize = 6;
  const directoryEntrySize = 16;
  const imageOffset = headerSize + directoryEntrySize * entries.length;
  const header = Buffer.alloc(imageOffset);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let nextImageOffset = imageOffset;
  entries.forEach(({ size, png }, index) => {
    const offset = headerSize + index * directoryEntrySize;
    header.writeUInt8(size === 256 ? 0 : size, offset);
    header.writeUInt8(size === 256 ? 0 : size, offset + 1);
    header.writeUInt8(0, offset + 2);
    header.writeUInt8(0, offset + 3);
    header.writeUInt16LE(1, offset + 4);
    header.writeUInt16LE(32, offset + 6);
    header.writeUInt32LE(png.length, offset + 8);
    header.writeUInt32LE(nextImageOffset, offset + 12);
    nextImageOffset += png.length;
  });

  return Buffer.concat([header, ...entries.map(({ png }) => png)]);
}

async function importMaster(sourcePath) {
  const imported = await sharp(sourcePath)
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: 1,
    })
    .resize({
      width: 922,
      height: 922,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .extend({
      top: 51,
      bottom: 51,
      left: 51,
      right: 51,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  const metadata = await sharp(imported).metadata();
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1024);
  assert.equal(metadata.hasAlpha, true);

  await mkdir(new URL("assets/branding/", repoRoot), { recursive: true });
  await writeFile(masterUrl, imported);
}

async function buildOutputs() {
  const master = await readFile(masterUrl);
  const metadata = await sharp(master).metadata();
  assert.equal(metadata.format, "png", "site icon master must be a PNG");
  assert.equal(metadata.width, 1024, "site icon master must be 1024px wide");
  assert.equal(metadata.height, 1024, "site icon master must be 1024px tall");
  assert.equal(metadata.hasAlpha, true, "site icon master must preserve transparency");

  const pngOutputs = await Promise.all(
    outputDefinitions.map(async (definition) => ({
      ...definition,
      contents: await renderPng(master, definition.size),
    })),
  );
  const faviconEntries = await Promise.all(
    faviconSizes.map(async (size) => ({ size, png: await renderPng(master, size) })),
  );

  return [
    ...pngOutputs,
    { url: faviconUrl, contents: packageIco(faviconEntries) },
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const importPath = optionValue(args, "--import-source");
  const check = args.includes("--check");

  if (check && importPath) {
    throw new Error("--check and --import-source cannot be used together");
  }
  if (importPath) {
    await importMaster(importPath);
  }

  const outputs = await buildOutputs();
  for (const output of outputs) {
    if (check) {
      const current = await readFile(output.url);
      assert.deepEqual(
        current,
        output.contents,
        `${fileURLToPath(output.url)} is stale; run npm run assets:site-icon`,
      );
      continue;
    }

    await mkdir(new URL("./", output.url), { recursive: true });
    await writeFile(output.url, output.contents);
    process.stdout.write(`Generated ${fileURLToPath(output.url)}\n`);
  }
}

await main();
