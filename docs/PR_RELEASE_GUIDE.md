# 单个 PR 双环境发布手册（PowerShell）

以后发布 RIIC-Web，以本手册作为操作入口。默认顺序是：**先 develop 开发环境，验证成功后再 main 生产环境**。

仓库：`Closure-RIIC/RIIC-Web`。适用于 Windows PowerShell 5.1 / PowerShell 7。最近核对：2026-10-31，依据当时 main 的发布脚本、工作流和实际分支保护。

日常使用下面的五行速用版；首次准备看第一节，遇到问题再看后续章节。同一时间只运行一条发布命令；多个 PR 依次发布，或者先准备经过审查的整合 PR。

## 日常发布：五行速用版

前提：已配置 Node.js 22.12+、GitHub CLI 登录，并在包含 `scripts/release-pr.mjs` 的 RIIC-Web 工作树中操作。PR 的代码已审查，目标为 develop。

**先执行前四行，核对屏幕显示的 PR、head 和 pendingDevelop；确认范围后再执行第五行。**

```powershell
$pr = [int](Read-Host "输入原 PR 编号（目标 develop）")
node scripts/release-pr.mjs $pr | Tee-Object -Variable planText
if ($LASTEXITCODE -ne 0) { throw "预览失败，请先处理报错" }
$head = (($planText -join "`n") | ConvertFrom-Json -ErrorAction Stop).head
npm run release:pr -- $pr --execute --head $head --approve-production --timeout-minutes 120
```

第五行会依次处理 develop 和 main 的检查、合并与部署。main 发布 PR 仍须符合 CODEOWNER 审核要求；`--approve-production` 只处理有权限批准的生产环境审批。出现额外 develop 变更或冲突时，先按详细流程处理。

网络中断后先按第三节查询远端状态，再用原 `$pr` / `$head` 恢复第五行；真正的 CI 失败先诊断，不直接重跑。首次执行和排查命令中的 `$repo` 均指 `Closure-RIIC/RIIC-Web`，设置方式见下一节。

## 先分清三个编号

| 名称 | 含义 | 用在哪里 |
| --- | --- | --- |
| 原 PR：`$pr` | 要发布的功能或修复，目标是 develop | `release:pr` 始终使用它，包括恢复执行 |
| 发布 PR：`$releasePr` | 开发环境成功后，机器人创建的 `release/* → main` PR | main 的审核、合并和查询 |
| 工作流 ID：`$runId` | Actions URL 中 `/actions/runs/` 后的数字 | 查日志、等待、重跑失败任务 |

`$head` 是**预览中原 PR 的完整提交 SHA**，不是 develop 合并 SHA，也不是 main 发布 PR 的 head。不要复制旧聊天里其他 PR 的编号或 SHA。

**双环境不等于每次都部署两个站点。** 方舟和终末地按实际影响分别部署；只改终末地时，方舟保留原来的成功部署 SHA 是正常的。

## 一、标准流程

### 1. 准备工作目录和原 PR

在包含当前发布脚本的 RIIC-Web 工作树中操作，不必切到 main 或 develop。保留已有未提交修改，不要为了发布重置或清理工作区。

```powershell
$repo = "Closure-RIIC/RIIC-Web"
$pr = [int](Read-Host "输入要发布的原 PR 编号（目标必须是 develop）")
if ($pr -lt 1) { throw "PR 编号必须是正整数" }

git status --short
git remote get-url origin
node --version
gh auth status
if ($LASTEXITCODE -ne 0) { throw "请先完成 GitHub CLI 登录" }
if (-not (Test-Path -LiteralPath "scripts/release-pr.mjs")) {
    throw "当前目录没有发布脚本，请使用包含最新 main 脚本的工作树"
}

gh pr view $pr --repo $repo --json number,title,state,baseRefName,headRefOid,mergeable,mergeStateStatus,maintainerCanModify
if ($LASTEXITCODE -ne 0) { throw "读取原 PR 失败" }
```

确认 origin 是本仓库、Node.js 为 22.12+，并使用有相应合并和生产审批权限的维护者账号登录。脚本使用现有 gh 登录，不需要粘贴 token 或服务器密码。

| PR 状态 | 下一步 |
| --- | --- |
| OPEN、目标 develop、可合并 | 继续预览 |
| BEHIND | 更新分支，重新预览 head，等待新检查 |
| CONFLICTING / DIRTY | 先解决冲突，不能直接发布 |
| UNKNOWN | GitHub 可能正在计算，稍后再查 |
| CLOSED 且未合并 | 停止，不能当作已发布，也不要自动重开 |
| MERGED | 恢复同一次发布时，保留原 PR 和已确认的 head |

仅在分支落后且有修改权限时执行：

```powershell
gh pr update-branch $pr --repo $repo
if ($LASTEXITCODE -ne 0) { throw "更新失败，先处理冲突或权限问题" }
```

更新后必须重新预览，不用 rebase 或强推处理日常发布。作者未开放维护者修改权限时，由作者更新，或在本仓库创建整合 PR、解决冲突并验证；后者发布时使用新的整合 PR 编号。

旧目录没有脚本时，先用 `git worktree list` 查找合适工作树。确需新建时，可在仓库内执行以下可选步骤；目录已存在就检查并复用，不覆盖它：

```powershell
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw "获取 main 失败" }
git worktree add --detach ..\RIIC-Web-release origin/main
if ($LASTEXITCODE -ne 0) { throw "创建失败，请检查目录是否已存在" }
Set-Location ..\RIIC-Web-release
```

不要向有用户改动的目录强制切分支、执行 `reset --hard` 或复制其他工作树的 node_modules。

### 2. 预览发布范围

```powershell
$planText = node scripts/release-pr.mjs $pr
if ($LASTEXITCODE -ne 0) { throw "发布预览失败，先处理报错" }
$plan = ($planText -join "`n") | ConvertFrom-Json
$plan | Format-List
```

这里用 `node` 得到纯 JSON；`npm run` 会附带命令标题，不能把全部输出直接交给 `ConvertFrom-Json`。仅想看预览，也可运行 `npm run release:pr -- $pr`。

确认 PR 编号、标题、代码 diff 和 head 是本次要发布的内容。特别留意：

- `merged: false` 且 `pendingDevelop: true`：develop 还有其他未发布差异，先审查它们，不要为了继续执行直接加 `--include-develop`。
- `merged: true` 且 `pendingDevelop: true`：恢复时可能只是原 PR 已进 develop、尚未进 main；这本身不是错误，但仍须核对有没有其他新增提交。

只有明确同意一起发布 develop 上的额外内容，才加 `--include-develop`。它是发布范围开关，不是网络修复或通用解锁选项。

### 3. 执行双环境发布

确认预览后，在同一个 PowerShell 会话执行：

```powershell
$head = $plan.head
if ($head -notmatch '^[0-9a-f]{40}$') { throw "缺少有效的已审查 head" }

npm run release:pr -- $pr --execute --head $head --approve-production --timeout-minutes 120
```

执行顺序：

```text
原 PR 必需检查 → 合并 develop → 合并后质量检查 → 开发部署
→ 创建/复用 main 发布 PR → main PR 检查及审核
→ 合并 main → 生产质量检查 → production 审批 → 生产部署和健康检查
```

`--approve-production` 授权脚本在质量检查通过、提交仍为当前 main、账号有权限时批准 production 环境。**它不代替 main PR 的 CODEOWNER 审核，也不授予额外权限。**

默认总等待 90 分钟；上面用 120 分钟，上限 240 分钟。超时或 Ctrl+C 只停止本地监控，GitHub 后台任务会继续。失败 CI 不会自动重跑。

遇到 main 审核阻塞，按下一节操作。若脚本已退出，批准后恢复同一条原 PR 命令；若仍在运行，让它继续，不启动第二份。

## 二、两种审批怎么处理

### main 发布 PR 仍是 OPEN

`gh pr merge ... --auto` 显示「will be automatically merged」只表示启用自动合并，不代表已合并。当前 main 要求必需检查和至少一位 CODEOWNER 批准；以实时保护规则为准。

列出发布 PR，结合原 PR 的 develop 合并提交和分支名核对，不能直接选第一条：

```powershell
gh pr list --repo $repo --base main --state open --json number,title,headRefName,headRefOid
if ($LASTEXITCODE -ne 0) { throw "读取发布 PR 列表失败" }
$releasePr = [int](Read-Host "输入已核对的 main 发布 PR 编号")

gh pr view $releasePr --repo $repo --json state,baseRefName,headRefName,headRefOid,mergeStateStatus,reviewDecision,autoMergeRequest
gh pr checks $releasePr --repo $repo --required
gh pr diff $releasePr --repo $repo
```

确认它来自本仓库、是 `release/* → main`，对应已验证的 develop 内容。通常分支名为 `release/automation/develop-<develop SHA>-<main SHA>`。审查 diff 后，由符合资格的 CODEOWNER 批准：

```powershell
gh pr review $releasePr --repo $repo --approve
if ($LASTEXITCODE -ne 0) { throw "审核失败，请处理权限或审核要求" }
```

作者不能批准自己的 PR，遇到这种情况由另一位符合要求的维护者审核。不用 `--admin`、取消审核或降低门禁。

自动合并已启用就等待。如需启用，先核对当前 head：

```powershell
$releaseInfo = gh pr view $releasePr --repo $repo --json state,headRefOid | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "读取发布 PR 失败" }
if ($releaseInfo.state -ne "OPEN") { throw "状态已变化，先核对是否已合并" }
$releaseHead = $releaseInfo.headRefOid

gh pr merge $releasePr --repo $repo --merge --auto --match-head-commit $releaseHead
if ($LASTEXITCODE -ne 0) { throw "合并请求失败，先查询远端状态" }
gh pr view $releasePr --repo $repo --json state,reviewDecision,mergeCommit
```

**以 MERGED 和非空 mergeCommit 为准。** 刚批准后可能需几秒更新状态，不要重复提交审核。恢复 `release:pr` 时仍用 `$pr` / `$head`，不替换为发布 PR 的编号和 head。

### 工作流显示 waiting

`waiting` 可能是 production 审批，也可能是调度或其他环境保护。用本次运行 ID 查询：

```powershell
$runId = [long](Read-Host "输入本次工作流运行 ID")
gh api "repos/$repo/actions/runs/$runId/pending_deployments"
gh run view $runId --repo $repo --web
```

脚本带 `--approve-production` 且账号有权限时会按条件审批。手动操作时，在工作流页面选择 `Review deployments`，核对 main 提交及 production 后批准。`gh run watch` 不会代替审批。

没有待审批项且已进入 `in_progress` 时，保持现有监控，不要另外触发发布。

## 三、异常恢复：先查远端状态

| 现象 | 处理方式 |
| --- | --- |
| GET EOF、HTTP 502/503/504、wsarecv、连接超时 | 读取 API 失败，先查 GitHub，不能据此认定部署失败或重跑 CI |
| Release failed，actual 为 failure、expected 为 success | 远端工作流失败，定位具体 job / step |
| 'failsurccess' | 终端把断言差异挤在一起，真正原因在日志 |
| REVIEW_REQUIRED / 自动合并后仍 OPEN | 查 PR 审核，检查通过不代表审核通过 |
| pendingDevelop: true | 按预览步骤核对范围，不能默认加范围开关 |
| Branch advanced / PR changed | 重新审查分支和范围，不强行用旧 head |
| CONFLICTING / DIRTY | 先解决代码冲突，网络重试无效 |

### A. API 连接失败：恢复监控

```powershell
gh run view $runId --repo $repo --json status,conclusion,headSha,attempt,jobs
```

确认同一提交和运行：进行中就等待；已成功就恢复原命令推进后续；只有远端确实失败才进入 B。

```powershell
npm run release:pr -- $pr --execute --head $head --approve-production --timeout-minutes 120
```

脚本会读取已有合并、工作流和部署记录，不会无条件新建发布。当前只对部分 GET 网络错误做有限重试，并不覆盖所有 EOF / Windows 连接错误。连续读不到同一接口时，通过 GitHub 页面核对，必要时按第四节完成同一发布链，不能猜测结果或跳过校验。

换终端后，重新设置 `$repo`、原 `$pr` 并预览。只有 head 与之前确认的一致，才恢复 `$head`，不要使用上一个 PR 的 `$plan`。

**写操作报错先查状态。** 合并、审批或触发工作流可能已生效，不能盲目重试。

### B. CI / 部署确实失败：诊断后重跑失败任务

```powershell
gh run view $runId --repo $repo
gh run view $runId --repo $repo --log-failed
```

- SSH 255 / 连接关闭：确定失败在上传、切换版本还是健康检查，核对是否已有一站成功，再决定重试。
- 类型、构建、业务断言失败：先修复原因并验证，不改弱断言、删测试或跳过检查。
- 怀疑偶发测试：先核对代码和日志，执行相关允许的测试；有证据时可重试一次。相同问题重复发生就修复根因，不无限重跑。

确认可重试后：

```powershell
gh run rerun $runId --repo $repo --failed
if ($LASTEXITCODE -ne 0) { throw "重试请求未确认成功，请先查询远端状态" }
```

然后恢复原 `$pr` / `$head` 的发布命令，等待最新运行次数。状态更新可能有延迟，先核对 attempt / status，不重复提交重跑请求。

若另建 PR 修复问题，develop / head 已变化，必须重新审查新范围。新预览提示额外 develop 内容时，明确确认包含原功能和修复后再执行，不机械恢复失效的旧命令。

## 四、脚本持续读 API 失败时，手动完成已有发布链

前提：已核对原 PR 的 develop 合并提交、相应 quality 和所有受影响应用的开发部署成功，且没有混入未审查提交。不能只凭构建成功或 PR 已合并直接发 main。

1. 按第二节完成对应 main 发布 PR 的检查、审核、正常合并。
2. 以该 PR 的实际合并 SHA 定位工作流，不直接选择「最新一条 main 运行」。
3. 完成 production 审批，等待部署、健康检查及各受影响应用的成功记录。

确认 main 发布 PR 已合并后：

```powershell
$releaseResult = gh pr view $releasePr --repo $repo --json state,mergeCommit | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $releaseResult.state -ne "MERGED") {
    throw "main 发布 PR 尚未确认合并"
}
$mainSha = $releaseResult.mergeCommit.oid
if ($mainSha -notmatch '^[0-9a-f]{40}$') { throw "缺少 main 合并 SHA" }

$runsText = gh run list --repo $repo --workflow frontend-quality.yml --branch main --commit $mainSha --limit 20 --json databaseId,status,conclusion,event,headSha,url
if ($LASTEXITCODE -ne 0) { throw "读取生产工作流失败" }
$runs = ($runsText -join "`n") | ConvertFrom-Json
$mainRun = @($runs) |
    Where-Object { $_.event -in @("push", "workflow_dispatch") } |
    Sort-Object databaseId -Descending | Select-Object -First 1
if (-not $mainRun.databaseId) { throw "暂未发现工作流，稍后查询，不要立即重复触发" }

$runId = $mainRun.databaseId
$mainRun | Format-List
gh run view $runId --repo $repo --web
gh run watch $runId --repo $repo --interval 15 --exit-status
```

等待审批时按第二节操作。watch 因网络退出不影响远端运行，先查实际状态；真实失败则按第三节 B 处理。

网络恢复后，可用原 PR 命令完成双环境和应用部署记录的最终校验。分支已前进时不要强行恢复，核对准确的历史运行、范围和部署记录。

## 五、怎样才算完成

成功时，脚本最终输出同时包含 development、production 的 JSON，各有 sha、runId、url、applications。

- [ ] 本次内容通过必需检查，按审核要求合并到 main。
- [ ] 两环境受影响应用完成部署和健康检查，有成功记录。
- [ ] 中断或失败按远端真实状态处理，没有把本地命令退出当作部署结果。
- [ ] 发布说明记录原 PR、发布 PR、两环境运行 ID、各应用 SHA，以及未解决问题。
- [ ] 页面变化列出入口、操作、预期效果的手动验收清单，待用户验证；CI 不代替 UI 验收。

四个应用 SHA 不必相同，main / develop 合并 SHA 也不必相同。只改终末地时，方舟可保留各环境上一版。脚本会验证基线是否覆盖应发布变更；是否回同步要看文件内容和策略，不能只比 SHA。

仅文档变化且没有历史未发布应用变更时，可能跳过部署，应说明「本次无应用部署」，不能把 skipped 描述为完成部署。

## 六、后续发布的统一约定

所有发布先读本手册，确认仓库、PR、环境和 diff；普通单 PR 默认用 release:pr。批量功能依次发布或做经过验证的整合 PR；特殊发布也保留来源核对、CI、审核、环境审批和验收。

解释、诊断、写文档不代表授权合并或发布。已有授权按范围持续推进，不重复索取相同批准；新增未审查内容、环境或生产数据操作时核对范围。

不使用 --admin、强推、取消保护、关闭测试或绕过审批排除障碍。API 失败先读状态，CI 失败先诊断，不统一回复「再跑一次」。实现或配置变化时先核对并更新手册，不套用旧命令。

技术细节参见：

- [发布脚本与应用范围](APPLICATION_RELEASE_AUTOMATION.md)
- [CI 与发布阶段](CI_RELEASE_FLOW.md)
- [产物验证与单应用重试](RELEASE_PIPELINE.md)
- [发布自动化管理手册](AUTO_MERGE_AGENT_RUNBOOK.md)

本地 AGENTS.md 已约定发布前阅读本手册，但该规则文件不公开跟踪。其他工作树也需要可见的文档入口；文档未提交前，不假定其他克隆已经获得它。
