import { createHash } from "node:crypto";
import { mkdir, lstat, readFile, writeFile, rm, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export function qualityRoot() {
  const root = process.env.ADMIN_QUALITY_STORAGE_DIR;
  if (!root || !path.isAbsolute(root)) throw new Error("ADMIN_QUALITY_STORAGE_DIR must be an absolute private directory");
  const resolved = path.resolve(/* turbopackIgnore: true */ root);
  const cwd = path.resolve(/* turbopackIgnore: true */ process.cwd());
  if (resolved === path.parse(resolved).root || resolved === cwd || resolved.startsWith(path.join(/* turbopackIgnore: true */ cwd, "public"))) throw new Error("Quality storage must be a dedicated private directory");
  return resolved;
}
export function qualityPath(...parts: string[]) {
  if (parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")) throw new Error("Invalid quality artifact key");
  return path.join(/* turbopackIgnore: true */ qualityRoot(), ...parts);
}
export async function ensurePrivateDirectory(...parts: string[]) {
  const root = qualityRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) throw new Error("Quality storage must not be a symlink");
  let current = root;
  for (const part of parts) {
    qualityPath(part);
    current = path.join(current, part);
    await mkdir(current, { recursive: true, mode: 0o700 });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid quality storage directory");
  }
  return current;
}
export async function writeArtifact(parts: string[], value: unknown) {
  await ensurePrivateDirectory(...parts.slice(0, -1));
  await writeFile(qualityPath(...parts), JSON.stringify(value), { flag: "wx", mode: 0o600 });
}
export async function readArtifact<T>(...parts: string[]): Promise<T> {
  const file = qualityPath(...parts);
  for (let i = 0; i <= parts.length; i++) if ((await lstat(qualityPath(...parts.slice(0, i)))).isSymbolicLink()) throw new Error("Invalid artifact symlink");
  return JSON.parse(await readFile(file, "utf8")) as T;
}
export async function removeArtifacts(kind: "drafts" | "batches" | "imports", id: string) {
  await ensurePrivateDirectory(kind);
  const target = qualityPath(kind, id);
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (info?.isSymbolicLink()) throw new Error("Refusing to clean symlink");
  if (info) await rm(target, { recursive: true });
}
export function hash(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }

export async function writeHeartbeat(value: unknown) {
  await ensurePrivateDirectory();
  const temporary = `heartbeat-${randomUUID()}.json`;
  await writeArtifact([temporary], value);
  await rename(qualityPath(temporary), qualityPath("heartbeat.json"));
}
