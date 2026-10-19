import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { posterDataOnly, readPosterFile, type SchedulePosterDocument } from "../schedule-poster-document.ts";

// Nitro releases run from .output. Keep shared snapshots outside a replaceable
// release directory; without an explicit path, preserve the local prototype.
const directory = () => {
  const posterStorage = process.env.SCHEDULE_POSTER_STORAGE_DIR?.trim();
  if (posterStorage) {
    if (!path.isAbsolute(posterStorage)) throw new Error("SCHEDULE_POSTER_STORAGE_DIR 必须是绝对路径。");
    return posterStorage;
  }
  const sharedStorage = process.env.BETA_STORAGE_DIR?.trim();
  if (sharedStorage) {
    if (!path.isAbsolute(sharedStorage)) throw new Error("BETA_STORAGE_DIR 必须是绝对路径。");
    return path.join(sharedStorage, "schedule-posters");
  }
  if (process.env.NODE_ENV === "production") throw new Error("请配置持久化作业目录 SCHEDULE_POSTER_STORAGE_DIR 或 BETA_STORAGE_DIR 后再使用作业码分享。");
  return path.join(process.cwd(), ".tmp", "schedule-posters");
};
export async function savePosterSnapshot(doc: SchedulePosterDocument): Promise<string> {
  const content = JSON.stringify(posterDataOnly(doc));
  await mkdir(directory(), { recursive: true });
  if ((await readdir(directory())).length >= 1000) throw new Error("本地作业库已满，请使用文件分享。");
  const code = randomBytes(6).toString("hex");
  await writeFile(path.join(directory(), `${code}.json`), content, { flag: "wx", mode: 0o600 });
  return code;
}
export async function loadPosterSnapshot(code: string): Promise<SchedulePosterDocument> {
  if (!/^[a-f0-9]{12}$/.test(code)) throw new Error("作业码应为 12 位字母数字。");
  return readPosterFile(await readFile(path.join(directory(), `${code}.json`), "utf8"));
}
