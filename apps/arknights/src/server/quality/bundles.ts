import { randomUUID } from "node:crypto";
import { readFile, readdir, lstat, copyFile, chmod, rename, unlink, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDatabase } from "../db/index.ts";
import { qualityBundle } from "../db/schema.ts";
import { InfraCliServeClient } from "../serve-client.ts";
import { inspectPlanComputeCapability } from "../plan-protocol.ts";
import { ensurePrivateDirectory, hash, qualityPath, readArtifact, writeArtifact } from "./storage.ts";

type Manifest = { id: string; executableSha256: string; files: Record<string, string>; embeddedData: boolean };
async function cleanupStaging(staging: string) {
  const target = qualityPath("bundles", staging);
  if (path.dirname(target) !== qualityPath("bundles") || !path.basename(target).startsWith("staging-")) throw new Error("Invalid staging cleanup target");
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (info?.isSymbolicLink()) throw new Error("Invalid staging symlink");
  if (info) await rm(target, { recursive: true });
}
export function bundleClient(id: string, embeddedData: boolean) {
  return new InfraCliServeClient({ resolveCliPath: () => qualityPath("bundles", id, "infra-cli"), resolveRuntimeDataDir: () => embeddedData ? null : qualityPath("bundles", id, "data"), cwd: () => qualityPath("bundles", id), timeoutMs: 600_000 });
}
export async function stopBundleClient(client: InfraCliServeClient) {
  const pid = client.info().pid;
  client.stop();
  if (!pid) return;
  for (let i = 0; i < 50; i++) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
}
export async function verifyBundle(id: string) {
  const manifest = await readArtifact<Manifest>("bundles", id, "manifest.json");
  if (manifest.id !== id || hash(JSON.stringify({ files: manifest.files, embeddedData: manifest.embeddedData })) !== id) throw new Error("Bundle manifest fingerprint mismatch");
  if (manifest.files["infra-cli"] !== manifest.executableSha256) throw new Error("Bundle executable fingerprint mismatch");
  const actual: string[] = [];
  async function inventory(parts: string[]) {
    const directory = qualityPath("bundles", id, ...parts);
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("Invalid bundle directory");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Invalid bundle symlink");
      const key = [...parts, entry.name];
      if (entry.isDirectory()) await inventory(key);
      else if (entry.isFile()) { if (key.join("/") !== "manifest.json") actual.push(key.join("/")); }
      else throw new Error("Invalid bundle artifact");
    }
  }
  await inventory([]);
  if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error("Bundle file inventory mismatch");
  for (const [name, expected] of Object.entries(manifest.files)) {
    const parts = name.split("/");
    const file = qualityPath("bundles", id, ...parts);
    if ((await lstat(file)).isSymbolicLink() || hash(await readFile(file)) !== expected) throw new Error("Bundle artifact fingerprint mismatch");
  }
  return manifest;
}
export async function requestBundleSync() {
  const id = randomUUID();
  await writeArtifact(["sync", `${id}.json`], { requestedAt: new Date().toISOString() });
  return { id };
}
export async function installProductionBundle() {
  const source = process.env.ADMIN_QUALITY_PRODUCTION_CLI;
  const sidecar = process.env.ADMIN_QUALITY_PRODUCTION_SHA256;
  const data = process.env.ADMIN_QUALITY_PRODUCTION_DATA;
  if (!source || !sidecar || !path.isAbsolute(source) || !path.isAbsolute(sidecar)) throw new Error("Production artifact source is not configured");
  if ((await lstat(source)).isSymbolicLink()) throw new Error("Production CLI must be a regular artifact");
  const executable = await readFile(source);
  const sha = hash(executable);
  const expected = (await readFile(sidecar, "utf8")).trim().split(/\s+/)[0];
  if (sha !== expected) throw new Error("Production CLI sidecar mismatch");
  const files: Record<string, string> = { "infra-cli": sha };
  const staging = `staging-${randomUUID()}`;
  await ensurePrivateDirectory("bundles", staging);
  try {
  await writeFile(qualityPath("bundles", staging, "infra-cli"), executable, { flag: "wx", mode: 0o500 });
  await chmod(qualityPath("bundles", staging, "infra-cli"), 0o500);
  async function copyData(directory: string, parts: string[]) {
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("Production data must not use symlinks");
    await ensurePrivateDirectory("bundles", staging, ...parts);
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error("Production data contains a symlink");
      if (entry.isDirectory()) await copyData(path.join(directory, entry.name), [...parts, entry.name]);
      else if (entry.isFile()) {
        const target = qualityPath("bundles", staging, ...parts, entry.name);
        await copyFile(path.join(directory, entry.name), target);
        files[[...parts, entry.name].join("/")] = hash(await readFile(target));
        await chmod(target, 0o400);
      } else throw new Error("Unsupported data artifact");
    }
  }
  if (data) { if (!path.isAbsolute(data)) throw new Error("Production data path must be absolute"); await copyData(data, ["data"]); }
  if (hash(await readFile(qualityPath("bundles", staging, "infra-cli"))) !== sha) throw new Error("CLI changed during copy");
  const embeddedData = !data;
  const id = hash(JSON.stringify({ files, embeddedData }));
  const client = bundleClient(staging, embeddedData);
  try {
    const capability = inspectPlanComputeCapability((await client.ping()).response);
    if (!capability.supported || capability.solverExecutableSha256 !== sha) throw new Error(capability.reason ?? "Solver fingerprint mismatch");
  } finally { await stopBundleClient(client); }
  await writeArtifact(["bundles", staging, "manifest.json"], { id, executableSha256: sha, files, embeddedData });
  try { await rename(qualityPath("bundles", staging), qualityPath("bundles", id)); }
  catch (error) { if (!(await verifyBundle(id))) throw error; }
  await verifyBundle(id);
  // Publish only after fingerprint, protocol and ping checks have succeeded.
  const [existing] = await getDatabase().select().from(qualityBundle).where(eq(qualityBundle.id, id));
  if (!existing) await getDatabase().insert(qualityBundle).values({ id, label: `Production ${sha.slice(0, 12)}`, executableSha256: sha });
  return id;
  } finally {
    await cleanupStaging(staging);
  }
}
export async function processBundleSync() {
  await ensurePrivateDirectory("sync");
  const requests = (await readdir(qualityPath("sync"))).filter((name) => /^[0-9a-f-]+\.json$/.test(name));
  let lastError: string | null | undefined;
  for (const name of requests) {
    let result;
    try { result = { ok: true, bundleId: await installProductionBundle() }; }
    catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "Bundle sync failed" }; }
    lastError = "error" in result ? result.error : null;
    await writeArtifact(["sync", `result-${name}`], result);
    await unlink(qualityPath("sync", name));
  }
  return lastError;
}
