/* global console, fetch, AbortSignal */
import { Buffer } from "node:buffer";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import process from "node:process";
import sharp from "sharp";

const repository = "yuanyan3060/ArknightsGameResource";
const commit = "512db2d9a1b58bfd35f8c93c4c7ff41e284f7b35";
const catalogue = JSON.parse(await readFile("packages/arknights-domain/src/generated/arkntools/operator-catalog.json", "utf8"));
const manifestPath = "apps/arknights/src/defense-portraits.json";
const directory = "apps/arknights/public/images/defense-operators";
const digest = (data) => createHash("sha256").update(data).digest("hex");
if (process.argv.includes("--check")) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.commit !== commit || manifest.portraits.length !== catalogue.length) throw Error("Portrait catalogue differs from pinned source");
  for (const [index, entry] of manifest.portraits.entries()) {
    if (entry.id !== catalogue[index].id || entry.name !== catalogue[index].name) throw Error("Portrait identity mismatch");
    const data = await readFile(`${directory}/${entry.id}.webp`);
    const metadata = await sharp(data).metadata();
    if (digest(data) !== entry.sha256 || metadata.format !== "webp" || !metadata.hasAlpha || metadata.height > 1000) throw Error(`Invalid portrait: ${entry.id}`);
  }
  console.log(`Validated ${manifest.portraits.length} local operator illustrations.`);
} else {
  await mkdir(directory, { recursive: true });
  const portraits = new Array(catalogue.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < catalogue.length) {
      const index = next++;
      const operator = catalogue[index];
      const source = `skin/${operator.id}_1b.png`;
      let data;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit}/${source}`, { signal: AbortSignal.timeout(45000) });
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          data = Buffer.from(await response.arrayBuffer());
          break;
        } catch (error) { if (attempt === 2) throw error; }
      }
      const image = await sharp(data).trim().resize({ height: 1000, width: 1000, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 95 }).toBuffer();
      await writeFile(`${directory}/${operator.id}.webp`, image);
      portraits[index] = { id: operator.id, name: operator.name, thumbnail: operator.portrait, source, sourceSha256: digest(data), sha256: digest(image) };
      if (++done % 36 === 0) console.log(`${done}/${catalogue.length} illustrations downloaded and compressed`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  await writeFile(manifestPath, JSON.stringify({ repository: `https://github.com/${repository}`, commit, portraits }, null, 2) + "\n");
  console.log(`Saved ${portraits.length} illustrations. Source rights remain with the respective rights holders.`);
}
