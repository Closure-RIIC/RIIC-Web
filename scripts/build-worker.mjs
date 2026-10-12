// 把任务队列 Worker 打成自包含的单个 ESM 产物（dist/plan-worker.mjs）。
// 部署时只需 node dist/plan-worker.mjs + 环境变量 + 求解器二进制，无需仓库源码。
import path from "node:path";
import { existsSync } from "node:fs";

import { build } from "esbuild";

function resolveAtAlias(request) {
  const base = path.resolve("src", request.slice(2));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

await build({
  entryPoints: ["scripts/plan-worker.mts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/plan-worker.cjs",
  logLevel: "info",
  plugins: [
    {
      name: "resolve-at-alias",
      setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => {
          const resolved = resolveAtAlias(args.path);
          if (!resolved) return { errors: [{ text: `Cannot resolve @/ import: ${args.path}` }] };
          return { path: resolved };
        });
      },
    },
  ],
});

await build({
  entryPoints: ["scripts/quality-worker.mts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/quality-worker.cjs",
  logLevel: "info",
});

await build({
  entryPoints: ["scripts/agent-worker.mts"], bundle: true, platform: "node", format: "cjs",
  outfile: "dist/agent-worker.cjs", logLevel: "info",
  plugins: [{ name: "server-only-worker", setup(builder) {
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
  } }],
});
