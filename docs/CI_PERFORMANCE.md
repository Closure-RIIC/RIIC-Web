# GitHub Actions 耗时与优化

审计日期：2026-11-02。仓库：Closure-RIIC/RIIC-Web。

## 测量口径

使用 gh run list --limit 50 获取最近 50 次运行，再通过 Jobs API 获取每个 job 的全部步骤。基线共 117 个 job，包含 PR、合并后发布和自动化工作流，不能把自动化任务的耗时当成测试耗时。

- 排队：job.created_at 到 job.started_at。
- 准备：runner、容器、checkout、依赖安装、下载、清理及步骤间开销。
- 执行：明确命名的测试、构建、校验和发布操作。
- 依赖等待：workflow 创建到 job 创建，单列，不冒充 runner 排队。

Jobs API 无法拆开同一个 shell step 内的多条命令。原 PR 的浏览器安装和 E2E 混在一个步骤里，新工作流把安装独立出来以便后续观察。异常时间戳保留在原始数据中，不进入均值：基线有 16 个 skipped job 返回负耗时，另有一个 success job 完成时间早于开始时间且没有步骤，故 PR 均值只有 5 个有效样本。

复查命令：

    node scripts/ci-timings.mjs --limit 50 --output .tmp/actions-timings

生成 runs.json、jobs.json、jobs.csv、summary.json 和 report.md。保存的原始 runs.json 可以通过 --input 再次离线分析。

## 优化前

| Job | 有效样本 | 排队均值 | 准备均值 | 执行均值 | job 总耗时均值 |
| --- | ---: | ---: | ---: | ---: | ---: |
| PR packages | 5 | 2.0s | 47.2s | 273.2s | 320.4s |
| Static and unit checks | 3 | 2.3s | 24.3s | 244.0s | 268.3s |
| Build release once | 4 | 2.0s | 23.3s | 98.8s | 122.0s |
| Database integration | 4 | 2.3s | 47.5s | 31.8s | 79.3s |
| Chromium 3/4 | 4 | 2.3s | 77.8s | 255.8s | 333.5s |
| Chromium plush 4/4 | 4 | 2.0s | 74.0s | 465.5s | 539.5s |

npm ci 通常约 10–12 秒，已有 setup-node npm 缓存。缓存占用约 1.59 GB；没有 Go、Rust、macOS job 或 Dockerfile 编译安装瓶颈。合并后的发布传输本身曾花费约 7–8 分钟，应与质量检查分别统计；本次验证不会向服务器发布。

本地原始 build:all 连续两次为 266.94 秒和 149.23 秒，第二次仍重新执行 Vite 和 TypeScript。

## 改动与覆盖

- PR 取消同一个 PR 的过时运行，main 使用每次运行独立的组；PR 保留稳定的 packages 必需检查，所有并行分支失败或取消都会使汇总失败。
- 纯文档 push 用 paths-ignore 过滤；PR 不在触发器过滤，完整变更判定后跳过重型任务。混合提交和无法判定的变更仍完整校验。
- PR 的 types、lint/国际化、业务逻辑/发布契约和构建/运行时校验并行执行；保留数据库生命周期、两个运行时、浏览器变更日志校验及产物打包。
- 合并后独立执行 lint 和类型检查，quality 显式要求成功。CI 构建不再重复类型检查；默认本地 build 仍包含类型检查和独立运行时准备。
- 普通 Chromium 八个分片，Agent 交互四个分片，毛绒 gallery 六个分片。后两组仍使用 chromium-plush 项目的单 worker 配置，重试、断言、渲染质量及 WebKit 验证不变。使用 Playwright --list 比较完整测试集合与全部分片并集，防止过滤遗漏或重复执行。
- 保留 setup-node 的 npm 缓存，安装使用 prefer-offline；无需历史的 job 使用浅 checkout。PostgreSQL 每秒检查健康状态并保留充分重试窗口。
- 本地构建缓存校验源码（含未跟踪文件）、忽略的环境文件、安装锁、Node/系统、环境变量及所有产物内容。输入变化、产物缺失或损坏、失败构建都不复用。CI 禁用此缓存，始终完整构建。设置 RIIC_BUILD_CACHE=0 可禁用本地复用。

未删除测试、缩小浏览器项目选择、降低保护规则或跳过部署身份/安全校验。未添加 node_modules、浏览器二进制或构建产物到 Actions 缓存。

## 第一轮远端验证与继续优化

2026-11-02，提交 fda363078b32bb0d78c01614721a52858027419e：

- Dual application packages 运行 41355919756 成功，总耗时 139 秒；构建与运行时 job 为 116 秒，其中构建 39 秒、Chromium 安装 16 秒、变更日志 E2E 23 秒。
- Post-merge release 运行 41355952791 成功，关闭部署，总耗时 431 秒；构建 job 从基线均值 122 秒降至 81 秒。
- 普通 Chromium 与 chromium-plush 各八片时，完整 435 个用例在分片并集中出现恰好一次。毛绒最后一片仍为 325 秒，其中测试 249 秒，因此第二轮将 gallery 和 Agent 交互独立分片，不再单纯按总用例数平均分配。
- 第一版本地连续构建为 186.22 秒和 18.04 秒。第二轮将 build:all 的输入和产物校验合并一次，避免两个应用重复扫描整个仓库、重复启动 npm 以及重复打包平台。
