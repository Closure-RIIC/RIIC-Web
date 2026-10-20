// Reproduce the fixed plush reflection map without baking it on every visitor's GPU.
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import process from "node:process";
import { Buffer } from "node:buffer";

const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import { WebGLRenderer, PMREMGenerator } from 'three';
  import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
  const renderer = new WebGLRenderer({ alpha: true });
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.04);
  const data = new Uint16Array(target.width * target.height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data);
  const bytes = new Uint8Array(data.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  window.bakedEnvironment = { width: target.width, height: target.height, data: btoa(binary) };
  target.dispose(); pmrem.dispose(); room.dispose(); renderer.dispose(); renderer.forceContextLoss();
` }, bundle: true, format: "iife", write: false });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => globalThis.bakedEnvironment);
  const compressed = gzipSync(Buffer.from(result.data, "base64"), { level: 9 });
  await mkdir("apps/arknights/public/textures", { recursive: true });
  await writeFile("apps/arknights/public/textures/plush-room-environment.bin.gz", compressed);
  process.stdout.write(`${JSON.stringify({ width: result.width, height: result.height, compressedBytes: compressed.length })}\n`);
} finally { await browser.close(); }
