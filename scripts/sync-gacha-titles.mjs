#!/usr/bin/env node
/* global fetch, AbortSignal, URL, console */
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";
import { titleLayouts } from "./gacha-title-layouts.mjs";
import { extractTitleAccent } from "./lib/gacha-title-color.mjs";

const run = promisify(execFile);
const root = new URL("../", import.meta.url);
const manifestUrl = new URL("src/generated/gacha-titles.json", root);
const sources = [
  { repository: "ArknightsAssets/ArknightsAssets", branch: "cn", directory: "assets/torappu/dynamicassets/ui/gacha" },
  { repository: "ArknightsAssets/ArknightsAssets2", branch: "cn", directory: "assets/dyn/ui/gacha" },
];

async function github(path) {
  const response = await fetch(`https://api.github.com/${path}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 403 || response.status === 429) {
    // Use the developer's existing GitHub CLI authentication if public API quota is exhausted.
    const { stdout } = await run("gh", ["api", path], { maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout);
  }
  if (!response.ok) throw new Error(`GitHub ${path}: ${response.status}`);
  return response.json();
}

function inspectPng(bytes, expectedSha) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid PNG title asset");
  const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (sha !== expectedSha) throw new Error("Title asset does not match the upstream Git blob");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) throw new Error("Unexpected title image dimensions");
  return { width, height };
}

async function readManifest() {
  try { return JSON.parse(await readFile(manifestUrl, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { titles: {} }; throw error; }
}

async function writeManifest(titles) {
  for (const asset of Object.values(titles)) {
    const images = asset.composition?.layers ?? [asset];
    asset.accent = await extractTitleAccent(await Promise.all(images.map((image) => readFile(new URL(`public${image.src}`, root)))));
  }
  await writeFile(manifestUrl, `${JSON.stringify({ titles: Object.fromEntries(Object.entries(titles).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`);
}

async function check() {
  const { titles } = await readManifest();
  if (!Object.keys(titles).length) throw new Error("No title assets have been synced");
  for (const [poolId, asset] of Object.entries(titles)) {
    if (asset.accent !== null && !/^#[0-9a-f]{6}$/.test(asset.accent ?? "")) throw new Error(`Invalid title accent for ${poolId}`);
    if (!/^[A-Z0-9_]+$/.test(poolId) || asset.src !== `/images/gacha-titles/${poolId}.png`) throw new Error(`Invalid title asset path for ${poolId}`);
    for (const image of [asset, ...(asset.composition?.layers ?? [])]) {
      if (image !== asset && !new RegExp(`^/images/gacha-titles/${poolId}/[a-z0-9_]+\\.png$`).test(image.src)) throw new Error(`Invalid title layer path for ${poolId}`);
      const dimensions = inspectPng(await readFile(new URL(`public${image.src}`, root)), image.sha);
      if (dimensions.width !== image.width || dimensions.height !== image.height) throw new Error(`Incorrect title dimensions for ${poolId}`);
    }
    const layout = titleLayouts[poolId];
    if (layout && (!asset.composition || asset.composition.layers.length !== layout.layers.length)) throw new Error(`Missing composed title for ${poolId}`);
    if (layout) {
      if (asset.composition.width !== layout.width || asset.composition.height !== layout.height) throw new Error(`Incorrect title canvas for ${poolId}`);
      layout.layers.forEach(([name, x, y], index) => {
        const layer = asset.composition.layers[index];
        if (layer.src !== `/images/gacha-titles/${poolId}/${name}.png` || layer.x !== x || layer.y !== y) throw new Error(`Incorrect title layer placement for ${poolId}/${name}`);
        if (x < 0 || y < 0 || x + layer.width > layout.width || y + layer.height > layout.height) throw new Error(`Title layer outside canvas: ${poolId}/${name}`);
      });
    }
  }
  console.log(`Verified ${Object.keys(titles).length} local gacha title images and their upstream hashes.`);
}

async function sync() {
  const selected = new Map();
  for (const source of sources) {
    const commit = await github(`repos/${source.repository}/commits/${source.branch}`);
    const revision = commit.sha;
    const parent = source.directory.slice(0, source.directory.lastIndexOf("/"));
    const directories = await github(`repos/${source.repository}/contents/${parent}?ref=${revision}`);
    const gacha = directories.find((entry) => entry.name === "gacha" && entry.type === "dir");
    if (!gacha) throw new Error(`Missing gacha directory in ${source.repository}`);
    const tree = await github(`repos/${source.repository}/git/trees/${gacha.sha}?recursive=1`);
    if (tree.truncated) throw new Error("Refusing a truncated title asset tree");
    const candidates = new Map();
    for (const entry of tree.tree) {
      const match = /^([a-z0-9_]+)\/(title|logo)\.png$/i.exec(entry.path);
      if (!match || entry.type !== "blob") continue;
      const poolId = match[1].toUpperCase();
      // Composite titles are assembled separately below; title.png may only be a subtitle.
      if (candidates.has(poolId) && match[2].toLowerCase() !== "title") continue;
      candidates.set(poolId, { poolId, sha: entry.sha, repository: source.repository, revision, path: `${source.directory}/${entry.path}` });
    }
    for (const [id, asset] of candidates) {
      selected.set(id, asset);
      const layout = titleLayouts[id];
      if (!layout) continue;
      for (const name of new Set(layout.layers.map(([name]) => name))) {
        const path = `${id.toLowerCase()}/${name}.png`;
        const entry = tree.tree.find((entry) => entry.path === path && entry.type === "blob");
        if (!entry) throw new Error(`Missing title layer ${path}`);
        selected.set(`${id}/${name}`, { poolId: id, layer: name, sha: entry.sha, repository: source.repository, revision, path: `${source.directory}/${path}` });
      }
    }
  }
  if (selected.size < 20) throw new Error("Unexpectedly few titles; refusing an incomplete sync");
  const queue = [...selected.values()];
  const downloaded = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const asset = queue.pop();
      const url = `https://raw.githubusercontent.com/${asset.repository}/${asset.revision}/${asset.path}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Title download ${asset.poolId}: ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const dimensions = inspectPng(bytes, asset.sha);
      downloaded.push({ ...asset, ...dimensions, bytes });
    }
  }));
  const { titles } = await readManifest();
  await mkdir(new URL("public/images/gacha-titles/", root), { recursive: true });
  const layers = new Map();
  for (const { poolId, layer, bytes, ...asset } of downloaded) {
    const src = `/images/gacha-titles/${poolId}${layer ? `/${layer}` : ""}.png`;
    if (layer) await mkdir(new URL(`public/images/gacha-titles/${poolId}/`, root), { recursive: true });
    await writeFile(new URL(`public${src}`, root), bytes);
    if (layer) layers.set(`${poolId}/${layer}`, { src, ...asset });
    else titles[poolId] = { src, ...asset };
  }
  for (const [poolId, layout] of Object.entries(titleLayouts)) {
    if (!selected.has(poolId)) continue;
    titles[poolId].composition = {
      width: layout.width,
      height: layout.height,
      layers: layout.layers.map(([name, x, y]) => ({ ...layers.get(`${poolId}/${name}`), x, y })),
    };
  }
  // Retain historic assets even when an upstream game update removes its old pool directory.
  await writeManifest(titles);
  await check();
}

if (process.argv.includes("--check")) await check();
else if (process.argv.includes("--colors-only")) {
  await writeManifest((await readManifest()).titles);
  await check();
}
else await sync();
