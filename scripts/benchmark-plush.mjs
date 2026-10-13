import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import console from "node:console";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5196";
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const mode of ["quality", "balanced", "saver"]) {
    const page = await browser.newPage({ viewport: { width: 400, height: 540 }, reducedMotion: "no-preference" });
    await page.addInitScript(mode => globalThis.localStorage.setItem("riic.plush.performance.v1", mode), mode);
    await page.goto(`${baseURL}/plush`);
    const avatar = page.locator('[data-fur-avatar="closure"]');
    await avatar.locator("canvas").waitFor();
    await page.waitForFunction(() => globalThis.document.querySelector('[data-fur-avatar="closure"]')?.getAttribute("data-fur-ready") === "true", null, { timeout: 60_000 });
    const bounds = await avatar.boundingBox();
    const samples = [];
    // Small passive gaze changes keep every tier drawing, without quality's
    // gesture-only adaptive sampling. Skip warm-up frames/one-off compilation.
    for (let i = 0; i < 16; i++) {
      const before = Number(await avatar.getAttribute("data-fur-frames"));
      await page.mouse.move(bounds.x + bounds.width * (i % 2 ? 0.55 : 0.45), bounds.y + bounds.height * 0.5);
      await page.waitForFunction(before => Number(globalThis.document.querySelector('[data-fur-avatar="closure"]')?.getAttribute("data-fur-frames")) > before, before);
      const sample = await avatar.evaluate(root => ({
        completionMs: Number(root.getAttribute("data-fur-frame-ms")),
        gpuMs: root.hasAttribute("data-fur-gpu-ms") ? Number(root.getAttribute("data-fur-gpu-ms")) : null,
        width: Number(root.getAttribute("data-fur-width")), height: Number(root.getAttribute("data-fur-pixels")),
        shells: Number(root.getAttribute("data-fur-shells")), backend: root.getAttribute("data-fur-renderer"),
      }));
      if (i >= 4) samples.push(sample);
    }
    const sorted = samples.map(sample => sample.completionMs).sort((a, b) => a - b);
    results.push({ mode, medianCompletionMs: sorted[Math.floor(sorted.length / 2)], samples });
    await page.close();
  }
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/plush-performance-benchmark.json", JSON.stringify({ viewport: "400x540", note: "Same local browser; completion includes polling and copy, not pure GPU time. Not a real phone benchmark.", results }, null, 2));
  console.log(JSON.stringify(results.map(({ mode, medianCompletionMs, samples }) => ({ mode, medianCompletionMs, ...samples[0] })), null, 2));
} finally { await browser.close(); }
