# 手动排班 WASM 评估器

手动排班页面点击“根据排班计算”时，会在浏览器中加载 `ArknightsInfraEval` 仓库编译出的 WASM，计算当前排班的房间效率。WASM 只服务于手动排班评估，不替代服务端求解器。

## 开发环境

构建脚本默认要求两个仓库位于同一目录下, 类似于：

```text
RIIC\
├─ RIIC-Web\
└─ ArknightsInfraEval\
```

在 `RIIC-Web` 根目录运行：

```bash
npm run wasm:build
```

脚本会在相邻的 `ArknightsInfraEval` 仓库中执行 Rust WASM 构建和 `wasm-bindgen`，然后更新 `RIIC-Web/public/wasm/`：

- `infra_eval_wasm.js`：wasm-bindgen 胶水文件；
- `infra-eval.<ruleset>.<hash>.wasm`：带规则集和内容哈希的 WASM 文件；
- `infra-eval-manifest.json`：记录 API、ruleset、胶水文件和 WASM 文件路径。

开发服务器和生产构建都从这个 manifest 读取文件路径。不要在源码中硬编码带哈希的 WASM 文件名，也不要直接从源码 `import("/wasm/infra_eval_wasm.js")`；Vite 开发服务器会把 `public` 文件误判为源码模块。当前客户端通过请求胶水文件并用 Blob URL 加载，开发和生产使用同一套逻辑。

## 生产发布或替换 WASM

正常流程是在发布构建前重新运行：

```bash
npm run wasm:build
npm run build
```

脚本会删除旧的版本化 WASM 文件，复制新胶水文件和 WASM，并重新生成 `public/wasm/infra-eval-manifest.json`。随后 `npm run build` 会把这些静态资源带入发布产物。

如果需要手动替换已经生成的资源，必须同时替换以下三项：

1. `public/wasm/infra_eval_wasm.js`；
2. 新的版本化 `.wasm` 文件；
3. `public/wasm/infra-eval-manifest.json` 中的 `ruleset` 和 `wasmUrl`。

只替换 `.wasm` 文件而不更新胶水文件或 manifest，可能出现资源 404、API 不匹配或 `WASM evaluator ruleset mismatch`。`src/lib/infra-eval/manifest.ts` 只保存 manifest 的固定 URL，通常不需要修改。

构建脚本会从 `ArknightsInfraEval/crates/infra-eval-core/src/evaluator.rs` 读取实际 ruleset，避免前端声明和 WASM 自报版本不一致。
