// Node 类型剥离运行 .ts 脚本时的路径别名 loader hooks：
// 解析 @/ 别名，并为相对导入补齐 .ts / .tsx / index.ts 扩展名。
// 由 register-hooks.mjs 注册。
import { stat } from "node:fs/promises";
import path from "node:path";
import { cwd } from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

async function isFile(target) {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  let target;
  if (specifier.startsWith("@/")) {
    target = path.join(fileURLToPath(new URL("../apps/arknights/src/", import.meta.url)), specifier.slice(2));
  } else if (specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../")) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : cwd();
    target = path.resolve(path.dirname(parent), specifier);
  } else {
    return nextResolve(specifier, context);
  }

  const candidates = [
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.js`,
    path.join(target, "index.ts"),
    path.join(target, "index.js"),
    target,
  ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
