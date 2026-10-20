import { inflateRawSync } from "node:zlib";
import { QUALITY_CASE_LIMIT, QUALITY_TOTAL_LIMIT } from "../../quality.ts";
import { REPRODUCTION_FILE_LIMIT, readReproductionPackage, type ReproductionSettings } from "../../reproduction-package.ts";

export type ImportFile = { name: string; data: Uint8Array };
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function unzipReproductions(bytes: Uint8Array): ImportFile[] {
  const data = Buffer.from(bytes);
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--) if (data.readUInt32LE(end) === 0x06054b50) break;
  if (end < 0 || data.readUInt32LE(end) !== 0x06054b50 || end + 22 + data.readUInt16LE(end + 20) !== data.length) throw new Error("ZIP 目录无效");
  if (data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) throw new Error("不支持分卷 ZIP");
  const count = data.readUInt16LE(end + 10);
  if (count > QUALITY_CASE_LIMIT || data.readUInt16LE(end + 8) !== count) throw new Error("ZIP 用例数量超出限制");
  let offset = data.readUInt32LE(end + 16);
  if (offset + data.readUInt32LE(end + 12) !== end) throw new Error("ZIP 目录边界无效");
  const result: ImportFile[] = [];
  let total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP 条目无效");
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10);
    const packed = data.readUInt32LE(offset + 20), size = data.readUInt32LE(offset + 24);
    const length = data.readUInt16LE(offset + 28), extra = data.readUInt16LE(offset + 30), comment = data.readUInt16LE(offset + 32);
    if (offset + 46 + length + extra + comment > end) throw new Error("ZIP 文件名边界无效");
    const name = data.subarray(offset + 46, offset + 46 + length).toString("utf8");
    if (!name || name.includes("\\") || name.startsWith("/") || name.includes(":") || name.split("/").includes("..") || [...name].some((character) => character.charCodeAt(0) < 32) || names.has(name)) throw new Error("ZIP 路径不安全或重复");
    names.add(name);
    const unixMode = data.readUInt32LE(offset + 38) >>> 16;
    if ((unixMode & 0xf000) === 0xa000) throw new Error("ZIP 不允许符号链接");
    if ((flags & 1) || ![0, 8].includes(method)) throw new Error("ZIP 不支持加密或此压缩算法");
    total += size;
    if (size > REPRODUCTION_FILE_LIMIT || total > QUALITY_TOTAL_LIMIT) throw new Error("ZIP 解压大小超出限制");
    const local = data.readUInt32LE(offset + 42);
    if (local + 30 > offset || data.readUInt32LE(local) !== 0x04034b50) throw new Error("ZIP 本地条目无效");
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    if (start + packed > data.readUInt32LE(end + 16)) throw new Error("ZIP 数据边界无效");
    const expanded = method === 0 ? data.subarray(start, start + packed) : inflateRawSync(data.subarray(start, start + packed), { maxOutputLength: REPRODUCTION_FILE_LIMIT });
    if (expanded.length !== size || crc32(expanded) !== data.readUInt32LE(offset + 16)) throw new Error("ZIP 数据校验失败");
    if (!name.endsWith("/")) result.push({ name, data: expanded });
    offset += 46 + length + extra + comment;
  }
  if (offset !== end) throw new Error("ZIP 目录长度无效");
  return result;
}
export function previewImports(files: ImportFile[], settings?: ReproductionSettings) {
  const expanded: (ImportFile & { error?: string })[] = [];
  let total = 0;
  for (const file of files) {
    let entries: (ImportFile & { error?: string })[];
    try { entries = file.name.toLowerCase().endsWith(".zip") ? unzipReproductions(file.data).map((entry) => ({ ...entry, name: `${file.name}/${entry.name}` })) : [file]; }
    catch (error) { entries = [{ name: file.name, data: new Uint8Array(), error: error instanceof Error ? error.message : "Invalid ZIP" }]; }
    for (const entry of entries) {
      total += entry.data.byteLength;
      if (expanded.length >= QUALITY_CASE_LIMIT || total > QUALITY_TOTAL_LIMIT) throw new Error("每批最多 500 用例，解压后总量不能超过 100 MiB");
      expanded.push(entry);
    }
  }
  return expanded.map((file, index) => {
    try {
      if (file.error) throw new Error(file.error);
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("仅支持 JSON 文件");
      return { id: String(index), name: file.name, input: readReproductionPackage(new TextDecoder("utf-8", { fatal: true }).decode(file.data), settings), error: null };
    } catch (error) { return { id: String(index), name: file.name, input: null, error: error instanceof Error ? error.message : "无效文件" }; }
  });
}
