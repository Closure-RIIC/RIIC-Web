import assert from "node:assert/strict";
import { cp, lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const [flag, app, outputFlag, destination] = process.argv.slice(2);
assert.ok(flag === "--app" && ["endfield", "platform"].includes(app) && outputFlag === "--output" && destination,
  "usage: stage-app-release.mjs --app <endfield|platform> --output <new-directory-outside-repository>");
const releaseSha = process.env.RELEASE_SHA ?? "", releaseTreeSha = process.env.RELEASE_TREE_SHA ?? "";
assert.match(releaseSha, /^[0-9a-f]{40}$/); assert.match(releaseTreeSha, /^[0-9a-f]{40}$/);
const output = path.resolve(destination), relative = path.relative(root, output);
assert.ok(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), "Release must be staged outside the source repository");
await lstat(output).then(() => { throw new Error("Release destination already exists"); }, error => { if (error.code !== "ENOENT") throw error; });
const source = path.join(root, app === "endfield" ? "apps/endfield/.output" : "services/platform-api/dist");
const entry = app === "endfield" ? "server/index.mjs" : "server.mjs";
assert.ok((await lstat(path.join(source, entry))).isFile(), "Build the application before staging");
async function inspect(directory) {
  for (const name of await readdir(directory)) {
    assert.ok(!/^\.env(?:\.|$)|^infra-cli(?:\.exe)?$|\.(?:pem|key|p12|pfx)$/.test(name), `Forbidden release entry: ${name}`);
    const file = path.join(directory, name), stat = await lstat(file);
    assert.ok(!stat.isSymbolicLink(), "Release inputs must not contain filesystem links");
    if (stat.isDirectory()) await inspect(file);
  }
}
await inspect(source);
await mkdir(output, { recursive: true });
await cp(source, path.join(output, "runtime"), { recursive: true });
await writeFile(path.join(output, "package.json"), JSON.stringify({
  name: `@riic/${app}-release`, private: true, type: "module", engines: { node: ">=22.12.0" },
  scripts: { start: `node runtime/${entry}` },
}, null, 2) + "\n");
await writeFile(path.join(output, ".release-artifact.json"), JSON.stringify({
  formatVersion: 1, kind: `riic-${app}`, releaseSha, releaseTreeSha,
  ...(app === "endfield" ? { accessMode: "public" } : {}),
}, null, 2) + "\n");
process.stdout.write(`Staged independent ${app} release at ${output}\n`);
