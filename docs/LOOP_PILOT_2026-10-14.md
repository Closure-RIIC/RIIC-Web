# 2026-10-14 首轮 loop 实践

本轮基线：`Closure-RIIC/RIIC-Web` 的远端 main，SHA `d31a6ae7c7b0b21d24b696aca9a14dda513d84a0`。在独立工作树执行，原工作区未提交的业务改动没有被纳入。观察器运行时工作区的新增内容是本次 loop 文件；业务源码与 lockfile 未修改。

## 实际执行

完成两次真实数据采集和一次离线回放。首轮 10 条信号；根据实际噪声收紧规则后，第二轮 9 条当前信号，另外保留 1 条已移出观察范围的历史记录。第二轮 2 条标为 changed，原因是 CI 分类规则/证据字段变化，不代表新发生两次故障。相同第二轮证据离线重放：9 条仍观察到、0 条新提醒。

本地原始报告（均被 `.tmp/` 忽略，不随 PR 发布；以下路径仅在实践工作树中可用）：

- 首轮报告：`.tmp/maintenance-loop-first/report.md`
- 第二轮报告：`.tmp/maintenance-loop-second/report.md`
- 第二轮完整证据：`.tmp/maintenance-loop-second/run.json`
- 离线回放结果：`.tmp/maintenance-loop-second/replay.json`

这是观察、调查和改进规则的实践。未冒充人工审阅，没有关闭 issue，没有运行无人值守 coding Agent，没有部署业务修复或启用远端新工作流。

## 发现一：定时质量检查成功，但安全审计未执行

[定时运行 38481024014](https://github.com/Closure-RIIC/RIIC-Web/actions/runs/38481024014) 的四个 WebKit 分片成功，`Static and unit checks` 为 skipped。代码里的 schedule/change-scope 依赖关系与实际 GitHub job 记录一致。

处理：准备独立只读 `maintenance-loop.yml`，直接进行 lockfile audit，不依赖被 schedule 跳过的 change-scope。该工作流只在合入默认分支后才能真正每日运行；目前是已验证的本地待审文件。

两轮真实 `npm audit --json --package-lock-only --ignore-scripts --audit-level=high` 都返回 total=0。lockfile SHA256：`0696339247115bb50dcada6d3b2cb53fdae0e27f109894622d06f3a469324942`。该结果只覆盖本轮 npm 已知漏洞数据库返回的依赖告警，不是全面安全审计。

## 发现二：资源同步被时间边界测试阻塞

[资源同步运行 38512022520](https://github.com/Closure-RIIC/RIIC-Web/actions/runs/38512022520) 的 `Generate and validate assets` 成功，`Run pre-PR quality gates` 失败，发布阶段跳过。失败测试为 `apps/arknights/src/server/gacha-archive-validation.test.ts` 的 legacy import 校验，错误是 `Missing expected exception`。

本地精确基线运行同一非 UI 测试：1 失败、1 通过，重现 CI 症状。调查发现测试构造 `Date.now() + 86400001`，生产解析器拒绝大于自身 `Date.now() + 86400000` 的值。两个 Date.now 之间只要经过 1 ms，原先在边界外的样本就可能落回允许范围。因此本轮证据指向测试时间竞态，不能因测试名称包含 ownership 就称其为权限漏洞。

对照实验：只在隔离测试进程固定 Date 时钟，原测试 2/2 通过；业务源码和仓库测试文件均未改动。

```powershell
node --test --experimental-strip-types src/server/gacha-archive-validation.test.ts
node --test --experimental-strip-types --import ./.tmp/freeze-gacha-test-clock.mjs src/server/gacha-archive-validation.test.ts
```

实践工作树中另有最小拟议补丁 `.tmp/gacha-clock-proposal.patch`（不随 PR 发布），用测试上下文 `t.mock.timers` 固定 Date，并由测试上下文清理，保留原有边界断言。`git apply --check --unidiff-zero` 通过。该补丁仅供下一阶段审阅，尚未应用；对照实验不等于已修复 CI。无需降低断言、放宽服务端校验或重跑发布来掩盖失败。

## 发现三：重复反馈候选

[issue #363](https://github.com/Closure-RIIC/RIIC-Web/issues/363) 与 [issue #364](https://github.com/Closure-RIIC/RIIC-Web/issues/364) 的标题、正文、复现步骤和附件链接相同。观察器仅根据标题归组，Agent 再只读核对正文，构成“机器筛选 → 证据确认”的一次实践。

建议维护者决定主记录并关联另一条；本轮不关闭、不评论，也不下载用户附件。重复条目的确认不代表原问题已经修复。

## 发现四：五个兼容代码候选，零自动删除

显式 Deprecation 标记出现在：

- `apps/arknights/src/server/admin-records-api.ts`
- `apps/arknights/src/server/admin-users-api.ts`
- `packages/platform-server/src/skland/account-data-api.ts`
- `packages/platform-server/src/skland/accounts-api.ts`
- `packages/platform-server/src/skland/status-api.ts`

这是 136 个服务端文件范围内的标记清单。没有访问流量与外部客户端迁移证据，删除条件不成立。下一轮一次选一个接口核对新旧路由和消费者；本轮没有引入“零引用即删除”的自动化。

## 对 loop 自身的一次改进

首轮排序中，一个诊断分支失败和一条已有后续成功运行的 develop 手动触发失败，占据了今天资源同步故障前面的摘要位置。

本轮改动：默认 CI 观察范围收紧到 main/develop；同工作流同分支的历史手动失败，如存在较新成功运行，保留为 info，仍要求核对覆盖。取消运行不自动当成业务故障。不修改权限、不增派 Agent、不新增外部通知。

新增相应回归场景，第二轮当前发现从 10 降至 9。保留移出窗口/范围项为 not_observed，不伪装成 resolved。使用第二轮真实元数据离线重放，0 条新增提醒，确认不会仅因新 run ID 重复告警。

## 验证与剩余事项

- 11 项观察器非 UI 测试通过：审计失败/畸形数据、告警保留、去重、严重度升级、源失败、暂缓到期、定时审计缺席、历史失败分类、重复候选和高风险摘要上限。
- 新增 3 个脚本的 ESLint 通过；工作流 YAML 解析通过，读权限、触发器与 action 固定 SHA 检查通过；公开仓库检查与 diff 空白检查通过。
- 未运行应用全套测试或 UI 单元测试。上面明确报告的既有寻访测试失败仍未在源码中修复。
- 观察阶段未推送、创建 PR、合并、启用远端日程、部署或修改数据库。原工作区未修改。
- 人工接受率、漏报率、节省分钟数尚无有效样本，不能根据本轮自评提权。

观察阶段结束后，维护者已单独授权推送这 6 个 loop 文件并创建指向 develop 的草稿 PR。交付分支基于最新 develop；上述实验仍明确对应 main 的记录 SHA，不替换为当前分支的测试结论。合并、启用日程和部署不在这次授权范围内。自动运行确认后再积累维护者反馈。受影响 UI：无。
