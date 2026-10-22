import { Buffer } from "node:buffer";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { env, stdout } from "node:process";

const buildRoot = path.resolve("apps/arknights/.output");
const clientRoot = path.join(buildRoot, "public", "assets");

const forbiddenMarkers = [
  { label: "森空岛用户文案", value: "森空岛" },
  { label: "森空岛公开 API", value: "/api/skland" },
  { label: "森空岛 App 拉起地址", value: "skland://" },
];
const sklandExpected = env.APP_DEPLOYMENT_ENV === "production"
  && env.SKLAND_FEATURE_ENABLED === "1";

async function collectFiles(root, include) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (include(target)) {
        files.push(target);
      }
    }
  }
  await visit(root);
  return files;
}

await stat(clientRoot).catch(() => {
  throw new Error("找不到 .output/public/assets，请先运行 production build。");
});

const clientFiles = await collectFiles(clientRoot, (file) => file.endsWith(".js"));
const publicDocuments = [];
const inspectedFiles = [...clientFiles, ...publicDocuments];
const matches = new Map(forbiddenMarkers.map((marker) => [marker.label, []]));
let inspectedBytes = 0;

for (const file of inspectedFiles) {
  const contents = await readFile(file, "utf8");
  inspectedBytes += Buffer.byteLength(contents);
  for (const marker of forbiddenMarkers) {
    if (contents.includes(marker.value)) {
      matches.get(marker.label).push(path.relative(buildRoot, file));
    }
  }
}

const presentMarkers = forbiddenMarkers.filter((marker) => matches.get(marker.label).length > 0);
if (!sklandExpected && presentMarkers.length) {
  const violations = presentMarkers.flatMap((marker) =>
    matches.get(marker.label).map((file) => `${file}：${marker.label}`)
  );
  throw new Error(`森空岛关闭时，production 浏览器产物仍包含相关内容：\n${violations.join("\n")}`);
}
if (sklandExpected && presentMarkers.length !== forbiddenMarkers.length) {
  const missing = forbiddenMarkers
    .filter((marker) => matches.get(marker.label).length === 0)
    .map((marker) => marker.label);
  throw new Error(`森空岛显式开启时，production 浏览器产物缺少预期边界：${missing.join("、")}`);
}

stdout.write(
  `production 浏览器产物开关校验通过：检查 ${inspectedFiles.length} 个文件、${inspectedBytes} 字节，森空岛${sklandExpected ? "已显式包含" : "已失败关闭"}。\n`
);
