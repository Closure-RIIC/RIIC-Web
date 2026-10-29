import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const git = async (cwd, args) => (await execute("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", maxBuffer: 128 * 1024 ** 2 })).stdout;

/** Keep each argv below Windows' command-line limit; Git receives literal paths. */
export function pathBatches(paths, limit = 12000) {
  const batches = [];
  let batch = [], length = 0;
  for (const file of paths) {
    if (batch.length && length + file.length + 16 > limit) { batches.push(batch); batch = []; length = 0; }
    batch.push(file); length += file.length + 16;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function readBlobs(root, ids) {
  if (!ids.size) return new Map();
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd: root, windowsHide: true });
    const chunks = [], errors = [];
    child.stdout.on("data", data => chunks.push(data));
    child.stderr.on("data", data => errors.push(data));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString("utf8")));
      const data = Buffer.concat(chunks), blobs = new Map();
      let offset = 0;
      while (offset < data.length) {
        const end = data.indexOf(10, offset);
        const [id, type, size] = data.subarray(offset, end).toString("utf8").split(" ");
        offset = end + 1;
        if (type !== "blob") continue;
        blobs.set(id, data.subarray(offset, offset + Number(size)).toString("utf8"));
        offset += Number(size) + 1;
      }
      resolve(blobs);
    });
    child.stdin.on("error", reject);
    child.stdin.end([...ids].join("\n") + "\n");
  });
}

/** Semantic message history, batched by resource paths rather than one huge argv. */
export const messageGitHistory = {
  id: "riic-git",
  async load(ctx) {
    const root = ctx.host.root;
    const top = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
    if ((await git(root, ["rev-parse", "--is-shallow-repository"])).trim() === "true") {
      throw new Error("Translation history requires a full clone (fetch-depth: 0).");
    }
    const resources = new Map(ctx.resources.filter(r => !r.block).map(r => [path.relative(top, path.resolve(root, r.path)).replaceAll("\\", "/"), r]));
    const commits = new Map(), head = new Map(), ids = new Set();
    const queue = [{ revision: "HEAD", resources }];
    const visited = new Set();
    for (let item = queue.shift(); item; item = queue.shift()) {
      for (const batch of pathBatches(item.resources.keys())) {
        const output = await git(top, ["log", item.revision, "--no-merges", "--raw", "--no-abbrev", "--format=%x01%H%x00%ct%x00%an", "--", ...batch.map(file => `:(literal)${file}`)]);
        for (const block of output.split("\x01").slice(1)) {
          const [header, ...lines] = block.split("\n"), [sha, time, author] = header.split("\0");
          const commit = commits.get(sha) ?? { sha, updatedAt: Number(time) * 1000, author, files: new Map() };
          commits.set(sha, commit);
          for (const line of lines.filter(line => line.startsWith(":"))) {
            const [meta, file] = line.split("\t"), [, , before, after, status] = meta.split(" ");
            const resource = item.resources.get(file);
            if (!resource) continue;
            let oldBlob = before;
            // Follow renames without passing all historical paths to Git at once.
            if (status === "A") {
              const renames = await git(top, ["diff-tree", "-r", "-M", "--raw", "--no-abbrev", "--no-commit-id", sha]);
              for (const rename of renames.trim().split("\n")) {
                const [info, from, to] = rename.split("\t");
                if (to !== file || !info.split(" ")[4]?.startsWith("R")) continue;
                oldBlob = info.split(" ")[2];
                const key = `${sha}:${from}`;
                if (!visited.has(key)) { visited.add(key); queue.push({ revision: `${sha}^`, resources: new Map([[from, resource]]) }); }
              }
            }
            commit.files.set(`${resource.path}:${file}`, { resource, before: oldBlob, after });
            for (const blob of [oldBlob, after]) if (!/^0+$/.test(blob)) ids.add(blob);
          }
        }
      }
    }
    for (const batch of pathBatches(resources.keys())) {
      const output = await git(top, ["ls-tree", "-r", "HEAD", "--", ...batch.map(file => `:(literal)${file}`)]);
      for (const line of output.trim().split("\n")) {
        const [meta, file] = line.split("\t");
        if (!resources.has(file)) continue;
        const id = meta.split(" ")[2]; head.set(file, id); ids.add(id);
      }
    }
    const blobs = await readBlobs(top, ids), parsed = new Map();
    const values = (resource, id) => {
      if (!id || /^0+$/.test(id)) return new Map();
      const key = `${resource.path}:${id}`;
      if (!parsed.has(key)) parsed.set(key, ctx.messagesIn(resource, blobs.get(id)));
      return parsed.get(key);
    };
    const history = new Map(), current = new Map();
    for (const [file, id] of head) {
      const resource = resources.get(file);
      for (const [key, value] of values(resource, id) ?? []) current.set(`${resource.locale}:${key}`, value);
    }
    for (const commit of [...commits.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const locales = Map.groupBy([...commit.files.values()], file => file.resource.locale);
      for (const [locale, files] of locales) {
        const before = new Map(), after = new Map();
        for (const file of files) {
          for (const [key, value] of values(file.resource, file.before) ?? []) before.set(key, value);
          for (const [key, value] of values(file.resource, file.after) ?? []) after.set(key, value);
        }
        for (const [key, value] of after) {
          if (before.has(key) && before.get(key) === value) continue;
          const locales = history.get(key) ?? new Map(); history.set(key, locales);
          const changes = locales.get(locale) ?? []; locales.set(locale, changes);
          changes.push({ updatedAt: commit.updatedAt, revision: commit.sha, author: commit.author, value });
        }
      }
    }
    return {
      changes: new Map([...history].map(([key, locales]) => [key, new Map([...locales].map(([locale, changes]) => [locale, { ...changes[0], value: current.get(`${locale}:${key}`) ?? changes[0].value }]))])),
      valueAt: (key, locale, at) => history.get(key)?.get(locale)?.find(change => change.updatedAt <= at)?.value,
    };
  },
  watch(ctx, onChange) {
    let revision, busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await git(ctx.host.root, ["rev-parse", "HEAD"]);
        if (revision !== undefined && next !== revision) onChange();
        revision = next;
      } catch (error) { ctx.host.logger?.warn(`Translation history: ${error.message}`); }
      finally { busy = false; }
    }, 2000);
    timer.unref();
    return { dispose: () => clearInterval(timer) };
  },
};
