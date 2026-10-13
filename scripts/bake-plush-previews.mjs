import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import process from "node:process";
import { Buffer } from "node:buffer";
import console from "node:console";

// Render authored default models once; static clients never need a GPU or the 3D bundle.
const root = process.cwd();
const bundle = await build({ stdin: {
  contents: `import { acquireGalleryFurRenderer } from './src/components/agent/fur-avatar-renderer';
    import { FUR_PRESETS } from './src/components/agent/fur-settings';
    window.bake = async (variant) => {
      const canvas = document.createElement('canvas');
      document.body.replaceChildren(canvas);
      const engine = await acquireGalleryFurRenderer(canvas);
      const surface = engine.surface ?? canvas;
      const context = engine.direct ? null : surface.getContext('2d');
      try {
        await engine.draw(context, 512, { yaw:0, pitch:0, press:0, lagX:0, lagY:0, time:0, active:false }, variant,
          FUR_PRESETS.fine, () => true, 512, { width:512, height:512 });
        while (!engine.ready()) await new Promise(resolve => setTimeout(resolve, 16));
        return surface.toDataURL('image/png');
      } finally { engine.release(); }
    };`,
  resolveDir: root, loader: "ts",
}, bundle: true, write: false, platform: "browser", format: "iife" });
const server = createServer(async (request, response) => {
  if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
  else if (request.url === "/textures/plush-room-environment.bin.gz") {
    try { response.end(await readFile(resolve(root, "public/textures/plush-room-environment.bin.gz"))); }
    catch { response.statusCode = 404; response.end(); }
  } else { response.setHeader("Content-Type", "text/html"); response.end('<canvas width="512" height="512"></canvas><script src="/bundle.js"></script>'); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const output = resolve(root, "public/images/plush");
  await mkdir(output, { recursive: true });
  for (const variant of ["closure", "silverash", "exusiai", "saileach", "mountain"]) {
    const data = await page.evaluate(variant => globalThis.bake(variant), variant);
    const image = await sharp(Buffer.from(data.split(",")[1], "base64")).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
    await writeFile(resolve(output, `${variant}.webp`), image);
    console.log(`${variant}: ${image.length} bytes`);
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
