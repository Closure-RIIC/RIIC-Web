import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeGenerated(file, content) {
  if (process.argv.includes("--check")) {
    const current = await readFile(file, "utf8").catch(() => "");
    if (current.replaceAll("\r\n", "\n") !== content.replaceAll("\r\n", "\n")) {
      throw new Error(`${file} is stale. Run npm run i18n:generate.`);
    }
  } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); }
}
