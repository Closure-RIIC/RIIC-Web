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

## 第二轮与稳定性修复

提交 5da7feaf979e845546f0af39d40b0e410dd4ffce 的 PR 运行 41357153348 成功，从创建到 packages 完成为 162 秒。提前启动的旧提交运行 41357138460 被本次 push 自动取消，验证了 cancel-in-progress 的实际行为。

完整质量运行 41357261765 的 18 个 Chromium 分片全部成功，最慢 job 从第一轮 325 秒降至 213 秒；345 个普通 Chromium、72 个 Agent、18 个 gallery 用例在全部分片中各出现一次，共 435 个，没有遗漏或重复。但是该运行的 Unit tests 失败，不能把 316 秒的 quality 结束时间计为成功结果。

失败来自 scripts/public-compression.test.mjs 的既有重试截止时间用例：总预算只够等待时，计时器唤醒与 Date.now() 的毫秒边界不一致，可能再发一次请求。基线运行 41306577201 也在同一用例失败。新增固定时钟的回归用例在修复前确定失败；修复使已用尽预算的等待直接报告 CHECK_TIMEOUT，保留原有单次请求断言和所有超时、网络重试测试。相关非 UI 检查共 95 项，94 项通过、1 项为原有 Windows 平台跳过；额外连续验证 100 次截止时间场景全部通过。

第二轮本地连续 build:all 为 253.39 秒和 7.36 秒。与原始第二次 149.23 秒相比，重复构建耗时下降 95.1%。首次构建受本机负载影响，不据此声称冷构建提速；7.36 秒主要用于校验输入及产物内容，并非跳过正确性检查。

## 最终成功结果

代码提交：946a873a6fa8aad8d120d2a04f32b7f2c2ac7295。验证分支：ci/actions-performance-20261102。PR 运行 41358301259 与完整质量运行 41358303569 均成功，deploy=false，没有合并或部署。

| 项目 | 优化前 | 最后一轮成功 | 耗时下降 |
| --- | ---: | ---: | ---: |
| 创建到 packages 必需检查完成 | 323.2s（5 次均值） | 184s | 43.1% |
| 完整质量检查，不含部署和工作流启动前排队 | 690s（3 次成功均值） | 310s | 55.1% |
| 发布构建 job | 122s（4 个成功 job 均值） | 54s | 55.7% |
| 每次完整质量运行的最慢 Chromium job | 541.3s（3 次成功均值） | 232s | 57.1% |
| 本地第二次 build:all | 149.23s | 7.36s | 95.1% |

三次成功 PR 运行分别为 139、162、184 秒，平均 161.7 秒，比原始均值减少约 50%。最后一轮同时启动 PR 与完整质量验证，packages 汇总 job 排队 33 秒；该排队保留在 184 秒中，没有为美化数字扣除。基线曾有一次整个发布工作流在启动前排队 517 秒，质量步骤实际用时 671 秒；上表的 690 秒不含这 517 秒，因此没有把发布队列解除混入测试提速。

最后一轮关键 job 的分段如下；job 总耗时为准备加执行，不含 runner 排队和前置依赖等待。

| Job | 排队 | 准备 | 执行 | job 总耗时 |
| --- | ---: | ---: | ---: | ---: |
| Static and unit checks | 2s | 19s | 143s | 162s |
| Application and tooling types | 2s | 21s | 53s | 74s |
| Lint | 2s | 19s | 45s | 64s |
| Build release once | 2s | 16s | 38s | 54s |
| Database integration | 5s | 35s | 35s | 70s |
| Browser release boundaries | 2s | 75s | 90s | 165s |
| Chromium 3/8（最慢分片） | 2s | 66s | 166s | 232s |
| Agent 2/4 | 21s | 56s | 157s | 213s |
| Plush gallery 4/6 | 79s | 81s | 74s | 155s |

并行缩短等待时间，但增加容器及依赖准备的重复开销：成功完整质量运行的 runner 总用时从基线平均 2974 秒增加至 3506 秒，约增加 17.9%。这是 job 时长求和，不是账单金额。PR 的 runner 总用时从 320.4 秒增加至 339 秒，约增加 5.8%。npm 缓存当前为 1,587,497,439 字节、9 项，约 1.59 GB，没有新增缓存种类。继续增加分片可能加剧 runner 排队；当前结果已将渲染长尾拆开，剩余开销主要是容器准备、runner 调度和单个分片内的测试。

本轮包含原有 WebKit 扫码和数字轮廓回归、生产配置边界、Agent 计费和审核边界、数据库集成及全部常规质量检查。定时完整 WebKit 四分片仍保留，本轮按普通 push 的覆盖范围使用 run_webkit=false，未额外执行夜间套件。actionlint 验证修改的三个 workflow 通过；相关非 UI 回归、ESLint 和 diff 检查通过。未运行本地 UI 单元测试或浏览器 agent。

## 数据与复查

本次审计原始文件保存在发起工作区的 .tmp/actions-performance/，未把临时日志加入公开仓库：

- baseline/runs.json、baseline/jobs.csv、baseline/report.md：最近 50 次运行、117 个 job 的完整分段。
- optimized/runs.json、optimized/jobs.csv、optimized/report.md：三轮共 6 次运行、103 个 job，包含真实失败记录。
- comparison.json：各轮质量门禁结束时间、runner 总时长和最长分片。
- shard-coverage-round2.json：435 个用例的分片全集覆盖验证。
- baseline-build-times.json、final-build-times.json：本地连续构建测量。
- baseline-static-failure.log、round2-static.log、verification-round3.log、deadline-stress.log：既有失败和修复后的验证。

耗时受托管 runner 负载影响，优化后样本仍较少；应继续用同一脚本观察真实 PR 的均值及长尾。当前结论仅覆盖本地构建和远端 CI，没有以此代替部署或线上验收。受影响 UI：无。
