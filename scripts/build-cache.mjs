import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import console from "node:console";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function digestFiles(root, files) {
  const hash = createHash("sha256");
  const paths = [...new Set(files)].sort();
  for (let offset = 0; offset < paths.length; offset += 32) {
    const entries = await Promise.all(paths.slice(offset, offset + 32).map(async relative => {
      const absolute = path.join(root, relative);
      try {
        const stat = await lstat(absolute);
        if (!stat.isFile()) throw new Error("Build cache accepts regular files only");
        return [relative, stat.mode, createHash("sha256").update(await readFile(absolute)).digest("hex")];
      } catch (error) {
        if (error.code === "ENOENT") return [relative, "missing"];
        throw error;
      }
    }));
    for (const entry of entries) hash.update(JSON.stringify(entry));
  }
  return hash.digest("hex");
}

async function inputDigest(root, environment, identity) {
  const { stdout } = await execute("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const files = stdout.split("\0").filter(Boolean);
  for (const directory of ["", "apps/arknights", "apps/endfield"]) {
    const entries = await readdir(path.join(root, directory)).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    files.push(...entries.filter(name => /^\.env(?:\.|$)/.test(name)).map(name => path.join(directory, name)));
  }
  const installation = await lstat(path.join(root, "node_modules/.package-lock.json"));
  files.push("node_modules/.package-lock.json");
  return createHash("sha256").update(JSON.stringify({ identity, node: process.version, platform: process.platform,
    architecture: process.arch, installed: installation.mtimeMs,
    environment: Object.entries(environment).sort(([left], [right]) => left.localeCompare(right)),
    source: await digestFiles(root, files) })).digest("hex");
}

async function outputDigest(root, outputs) {
  const files = [];
  async function visit(relative) {
    const stat = await lstat(path.join(root, relative));
    if (stat.isDirectory()) {
      const entries = await readdir(path.join(root, relative));
      if (entries.length === 0) files.push(relative + "/.empty-directory");
      for (const entry of entries) await visit(path.join(relative, entry));
    } else if (stat.isFile()) files.push(relative);
    else throw new Error("Build cache does not reuse symlinked outputs");
  }
  for (const output of outputs) await visit(output);
  return digestFiles(root, files);
}

export async function cachedBuild({ root, name, outputs, identity, environment = process.env, build, log = console.log }) {
  if (environment.CI || environment.RIIC_BUILD_CACHE === "0") { await build(); return false; }
  const cache = path.join(root, "node_modules/.cache/riic-build", name + ".json");
  let inputs;
  try {
    inputs = await inputDigest(root, environment, identity);
    const saved = JSON.parse(await readFile(cache, "utf8"));
    if (saved.version === 1 && saved.inputs === inputs && saved.outputs === await outputDigest(root, outputs)) {
      log("Reusing verified unchanged build: " + name);
      return true;
    }
  } catch { log("Building without a reusable cache: " + name); }
  await unlink(cache).catch(error => { if (error.code !== "ENOENT") throw error; });
  await build();
  try {
    if (!inputs || inputs !== await inputDigest(root, environment, identity)) return false;
    const contents = JSON.stringify({ version: 1, inputs, outputs: await outputDigest(root, outputs) });
    await mkdir(path.dirname(cache), { recursive: true });
    const temporary = cache + "." + process.pid + ".tmp";
    await writeFile(temporary, contents);
    await rename(temporary, cache);
  } catch { log("Build succeeded without saving a cache: " + name); }
  return false;
}
