import assert from "node:assert/strict";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
const output = path.resolve(".output");
const policy = JSON.parse(await readFile("build-tracing-policy.json", "utf8"));
const forbidden = [...policy.excludedFiles, ...policy.excludedDirectories.filter((entry) => entry !== "public")];
let count = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const relative = path.relative(output, file).replaceAll("\\", "/");
    const metadata = await lstat(file);
    assert.ok(!metadata.isSymbolicLink(), "Release contains a link: " + relative);
    assert.ok(!/(^|\/)\.env(?:\.|$)/.test(relative), "Release contains an environment file: " + relative);
    assert.ok(!forbidden.some((name) => relative === name || relative.startsWith(name + "/")), "Release contains excluded content: " + relative);
    if (entry.isDirectory()) await inspect(file);
    else { assert.ok(entry.isFile(), "Release entry is not a regular file: " + relative); count++; }
  }
}
await inspect(output);
assert.ok((await lstat(path.join(output, "server/index.mjs"))).isFile());
process.stdout.write("Production runtime boundary passed: " + count + " files, no credentials, solver, storage or repository-external links.\n");
