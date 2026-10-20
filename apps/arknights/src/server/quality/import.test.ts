import assert from "node:assert/strict";
import test from "node:test";
import { previewImports, unzipReproductions } from "./import.ts";

test("preview keeps valid entries and reports each invalid JSON separately", () => {
  const files = ["{", "[]", "not json"].map((value, i) => ({ name: `${i}.json`, data: Buffer.from(value) }));
  const entries = previewImports(files);
  assert.equal(entries.length, 3);
  assert.ok(entries.every((entry) => entry.error && !entry.input));
  assert.throws(() => previewImports(Array.from({ length: 501 }, () => files[0])), /500/);
  assert.match(previewImports([{ name: "big.json", data: Buffer.alloc(2 * 1024 * 1024 + 1, 32) }])[0].error!, /2 MiB/);
});
// A standards-compliant empty stored member: CRC32 and compressed size are both zero.
function archive(name: string, size = 0, mode = 0) {
  const n = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(size, 24); central.writeUInt32LE(mode >>> 0, 38);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length, 16);
  return Buffer.concat([local, n, central, n, end]);
}
test("ZIP rejects traversal, symlinks, forged sizes and truncated directories", () => {
  assert.equal(unzipReproductions(archive("case.json"))[0].name, "case.json");
  for (const name of ["../case.json", "/case.json", "C:/case.json", "a\\case.json"]) assert.throws(() => unzipReproductions(archive(name)), /路径/);
  assert.throws(() => unzipReproductions(archive("link.json", 0, 0xa000 << 16)), /符号链接/);
  assert.throws(() => unzipReproductions(archive("bomb.json", 3 * 1024 * 1024)), /大小/);
  assert.throws(() => unzipReproductions(archive("bad.json", 1)), /校验/);
  assert.throws(() => unzipReproductions(Buffer.from("PK")), /目录/);
});
