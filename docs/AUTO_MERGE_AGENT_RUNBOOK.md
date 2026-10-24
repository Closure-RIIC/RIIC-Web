# RIIC-Web 自动合并配置：Agent 执行手册

本文件用于把 RIIC-Web 的自动合并配置工作交接给另一个 Agent。先核对实际仓库状态，再按用户授权的范围执行；每一步都以“完成条件”为结束标准。

## 目标与范围

目标仓库：`Closure-RIIC/RIIC-Web`。

预期流程：维护者给 PR 添加 `automerge` 标签 → 必需检查通过，无需审核 → 合入 `develop` → 部署受影响的应用 → 自动创建发布 PR → 发布 PR 通过检查、由管理员确认后合入 `main` → 生产环境审批 → 部署受影响的生产应用。

明日方舟与终末地分别维护开发、生产部署状态。明日方舟独有改动跳过终末地部署；共享改动可能部署两站。终末地使用文件树增量传输，完整校验后切换版本。第一次建立新格式的部署基线时，两站会各部署一次。

按用户指令确定本次范围，沿用同一任务中仍有效的授权：

| 用户要求 | 执行范围 |
| --- | --- |
| 整理文档、说明、检查配置 | 文档或只读检查 |
| 配置自动合并 | 仓库设置、App、安装、变量、Secret、标签；缺失的自动化开关先初始化为 `0` |
| 启用自动合并 | 上述配置与代码前置条件满足后，启用 `PR_AUTOMATION_ENABLED` |
| 启用自动发布 PR | 开发部署已验证后，启用 `RELEASE_PROMOTION_ENABLED` |
| 合并、发布、线上验证 | 仅执行用户已经授权的仓库、分支、环境和发布范围 |

读取此文件不单独授予外部写入或发布权限。对已有明确授权内的下一步直接执行；遇到缺失权限或超出范围的操作，报告具体阻塞，继续完成不依赖它的工作。

## 1. 只读核对当前状态

先查看本地工作区状态并读取适用的协作规则。下面命令适用于已登录的 GitHub CLI，可在 PowerShell 中逐条执行：

```powershell
git status --short
gh api user --jq .login
gh api repos/Closure-RIIC/RIIC-Web --jq '{owner: .owner.login, owner_type: .owner.type, default_branch: .default_branch, allow_auto_merge: .allow_auto_merge, allow_merge_commit: .allow_merge_commit, permissions: .permissions}'
gh variable list --repo Closure-RIIC/RIIC-Web --json name,value
gh secret list --repo Closure-RIIC/RIIC-Web --json name
gh api repos/Closure-RIIC/RIIC-Web/labels/automerge --jq .name
gh api 'repos/Closure-RIIC/RIIC-Web/contents/.github/workflows/release-automation.yml?ref=main' --jq .sha
```

Secret 查询只读取名称；已有 Secret 的明文无法通过 GitHub API 取回。遇到 `403` 或 `404`，结合仓库访问权限判断是权限不足还是对象不存在。

本次实现已推送到组织仓库。其他 Agent 直接获取以下远端分支，并以分支最新提交为准：

| 项目 | 位置 |
| --- | --- |
| 远端仓库 | `https://github.com/Closure-RIIC/RIIC-Web.git` |
| 实现分支 | `feat/app-scoped-deployment-20261024` |
| 初版实现提交 | `8a413157a9d10b90d4d524312c07dc324ed1a68f`；组织迁移修正位于该提交之后 |

执行 `git fetch origin feat/app-scoped-deployment-20261024` 获取实现。核对 `origin` 已指向组织仓库；仅检出初版提交会遗漏组织迁移修正。通过 PR/API 核对当前合并状态，不从手册推断已经上线。

上述位置是交接线索；执行时仍以可访问的代码、远端分支和工作流内容核对版本。

必须核对的实现文件：

- `.github/workflows/pr-automation-request.yml`：普通 PR 事件入口，无 App 凭据。
- `.github/workflows/release-automation.yml`：在受信的 `main` 代码上执行合并与发布 PR 自动化。
- `.github/workflows/frontend-quality.yml`、`deploy.yml`、`deploy-verified.yml`：质量门、部署与单应用重试。
- `scripts/release-automation.mjs`、`app-release-plan.mjs`、`release-provenance.mjs`：策略、应用范围及部署来源校验。

如果工作流中的变量名或权限已变化，以当前实现为准，并先修正文档与实际配置的差异。只有旧版部署工作流时，不能直接按新版配置宣布启用成功。

**完成条件：** 已确定当前操作者、配置权限、已有配置及远端代码版本；已区分“需要新增”“可以复用”“受权限限制”的项目。

## 2. 核对门禁，再开启仓库原生 auto-merge

先读取两个分支的 protection 和适用 rulesets。两分支都要求 PR 检查 `packages`（来自 `Dual application packages`）；`develop` 审核数为 0，不要求 CODEOWNER 或最后一次推送审核。`main` 额外要求 `Release branch only` 和一位管理员 CODEOWNER 批准。CODEOWNERS 覆盖全部路径，列出当前仓库管理员；管理员名单变更时同步更新。使用实际 check-run 名称并核实检查来源为 GitHub Actions。`quality` 只在合并后运行，不能配置为 PR 必需检查。

GitHub 不允许 PR 作者批准自己的 PR。为 main 配置仅含当前管理员的 `bypass_pull_request_allowances.users`，App 和 team 列表为空，允许管理员在检查通过后直接确认自己提交的 PR，不必另找第二个人。`enforce_admins=true` 保持不变，管理员仍须通过必需 CI 和发布策略；不启用 `require_last_push_approval`。机器人创建的 main PR 由任一管理员批准一次即可。保留生产 Environment 审批。

门禁缺失时按已有管理授权补齐；没有调整授权则报告具体缺口，保持自动化开关关闭。先确认检查在对应目标分支 PR 上确实运行，并核对管理员名单及权限。

新版 `sync-arkntools-assets.yml` 使用单仓库 App 令牌创建资源 PR，以原生 auto-merge 等待 main 的检查和管理员批准。定时任务发现尚未合并的资源 PR 时保留其提交；新分支不强制推送。资源 PR 实际合入 main 后，`pull_request: closed` 处理器核实 App 作者、仓库、合并 SHA 与受管路径，再创建 develop 对齐 PR；该 PR 只等待检查，无需人工审核。App 合并产生的 push 正常触发部署。`PR_AUTOMATION_ENABLED=0` 时只建 PR，不启用其自动合并；开启后可由维护者为之前的待审资源 PR 手动启用原生 auto-merge。

迁移时核对 main 上已是这套等待式实现。旧版使用 `GITHUB_TOKEN` 立即调用合并 API，新增门禁会阻止它；不得添加机器人绕过。新旧切换期间自动化开关保持关闭。

入口：[仓库 Settings](https://github.com/Closure-RIIC/RIIC-Web/settings) → General → Pull Requests → 勾选 **Allow auto-merge**。

具备相应权限且操作已获授权时，也可执行：

```powershell
gh repo edit Closure-RIIC/RIIC-Web --enable-auto-merge
```

确认 **Allow merge commits** 已开启，因为当前脚本使用 `gh pr merge --auto --merge`。如果仓库策略禁止 merge commit，应报告策略冲突，不擅自修改合并策略。

保留分支保护、必需 CI、审核要求及 `production` 环境审批。App 不加入保护规则的绕过名单。

**完成条件：** API 返回 `allow_auto_merge=true`，当前合并方式被允许，原有质量与审批门禁仍有效。仅有 push 权限时，交给仓库维护者或管理员完成设置。

## 3. 创建或复用 GitHub App

先检查是否已有满足用途、权限和仓库安装范围的 App，避免重复创建。仓库已属于组织 `Closure-RIIC`，建议使用该组织拥有的 App。

入口：组织 Settings → Developer settings → GitHub Apps → New GitHub App。按以下值设置：

| 字段 | 值 |
| --- | --- |
| GitHub App name | 一个未被占用的名称，例如 `riic-web-release-bot` |
| Homepage URL | `https://github.com/Closure-RIIC/RIIC-Web` |
| Callback URL、Setup URL | 留空 |
| Request user authorization、Enable Device Flow | 不勾选 |
| Webhook → Active | 取消勾选；此 App 仅用于 Actions 中的安装令牌认证 |
| Installation scope | 在 `Closure-RIIC` 下创建时选 `Only on this account` |

如果现有个人 App 设置为 `Only on this account`，仓库转移不会自动完成 App 转移与安装。可由 App 所有者在 Advanced → Transfer ownership 将 App 转给 `Closure-RIIC`，再安装到该组织；另一种选择是经用户同意将 App 改为允许跨账号安装。完成后核对 App ID、私钥和安装范围，保留有效私钥，不默认重新生成。

在 **Repository permissions** 配置：

| 权限 | 级别 |
| --- | --- |
| Contents | Read and write |
| Pull requests | Read and write |
| Issues | Read and write；用于标签 |
| Actions | Read-only |
| Checks | Read-only |
| Commit statuses | Read-only |
| Deployments | Read-only |
| Metadata | 保持默认 Read-only |

其他权限保持默认。创建后记录应用页面显示的 **App ID**。

**完成条件：** 已有确定的 App ID、App 所有者和上述权限；尚未把创建成功等同于已安装或已可用。

## 4. 安装 App 并保存私钥

在应用设置里进入 **Install App**，选择 `Closure-RIIC`，选择 **Only select repositories**，只勾选 `RIIC-Web`，完成安装。修改已有 App 权限后，确认安装端也接受了更新后的权限。

新建 App 的私钥入口为 **Credentials → Key pairs → New key**；部分界面可能显示 **Private keys → Generate a private key**。生成后会下载 PEM 文件。复用有效 App 与 Secret 时，无需为了重新配置而额外生成或轮换私钥。

打开[仓库 Actions Secrets](https://github.com/Closure-RIIC/RIIC-Web/settings/secrets/actions)，通过 **New repository secret** 保存：

| 名称 | 内容 |
| --- | --- |
| `RELEASE_APP_PRIVATE_KEY` | PEM 文件的完整文本，保留首尾标记和换行 |

此项是 **Repository secret**，因为自动合并工作流没有绑定部署 Environment。不要只放进 `development` 或 `production` 的 Environment secrets。

私钥通过 GitHub Secret 页面或受控的标准输入写入。报告只包含 Secret 名称和存在状态，不包含私钥文本。不要把私钥、服务器密码或个人令牌写进聊天、仓库、日志或 PR。

**完成条件：** App 安装范围包含目标仓库，所需权限生效，仓库 Secret 名称存在。Secret 存在只证明已经保存；实际认证是否成功要在后续工作流中验证。

## 5. 配置变量和标签

打开[仓库 Actions Variables](https://github.com/Closure-RIIC/RIIC-Web/settings/variables/actions)，通过 **New repository variable** 配置：

| 名称 | 初次配置值 | 启用值及用途 |
| --- | --- | --- |
| `RELEASE_APP_ID` | 第 3 步的 App ID | 与私钥属于同一个 App |
| `PR_AUTOMATION_ENABLED` | `0` | `1`：处理带 `automerge` 标签的 PR |
| `RELEASE_PROMOTION_ENABLED` | `0` | `1`：开发部署成功后自动创建和推进发布 PR |
| `DEPLOY_AUTOMATION_ENABLED` | 读取现有值 | 本项目部署依赖其为 `1`；变更需属于已授权发布范围 |

仅对缺失的开关执行初始化。已有开关为 `1` 时先查明是否正在使用，按本次范围保留或变更，避免把重新配置变成意外停用。

打开[仓库 Labels](https://github.com/Closure-RIIC/RIIC-Web/labels)，创建名称精确为 `automerge` 的标签；已存在则复用。颜色不影响行为。

**完成条件：** 变量名称、层级和值正确；App ID 与私钥配套；`automerge` 标签存在。凭据准备完成但代码尚未上线时，状态记为 `configured`。

## 6. 确认代码上线后再启用

执行这一阶段必须已有相应的代码合并、发布或启用授权。若本次仅要求配置，报告待办项即可，不自行扩大范围。

1. 通过既有 PR 流程把实现纳入 `develop` 和 `main`；核对实际 diff。进入 main 的源分支必须符合当前 `main-release-policy.yml`。不要为了安装自动化而绕过 release 分支策略。
2. 保留并完成必需 CI。测试限制与必需流水线冲突时，先核对本任务已有授权及其范围；无法消解的冲突具体报告，不删测试或降低质量门。
3. 通过既有审批完成首次开发与生产部署，确认两款应用各自的成功记录。新基线缺失时部署两站是预期行为，不能据此判定“只部署受影响应用”失效。
4. 确认 `main` 上存在新版自动化工作流与脚本，再把 `PR_AUTOMATION_ENABLED` 设为 `1`。
5. 开发部署验证完成且已授权自动发布 PR 时，再把 `RELEASE_PROMOTION_ENABLED` 设为 `1`。

**完成条件：** 远端代码和开关都已就绪，首次部署基线已核实，生产审批仍存在。尚未观察过实际自动化运行时，只能报告 `activated`，不能报告端到端验证完成。

## 7. 验收自动化行为

优先使用下一次已授权的真实 PR，或已授权的验证任务；不为验证自动合并而擅自创建、合并无关生产改动。

- [ ] PR 属于同一仓库、非草稿，目标为 `develop`；目标为 `main` 时，源分支符合 `release/*` 策略。带 `direct-main-release` 的 PR 不由这套自动合并逻辑处理。
- [ ] 具有 write、maintain 或 admin 权限的维护者添加 `automerge` 标签。
- [ ] `PR automation request` 成功后，触发 `Release PR automation`；App 令牌创建成功。
- [ ] PR 原生 auto-merge 已启用，必需检查和审核仍会阻止未就绪的合并。
- [ ] 合入 develop 后，`Post-merge release` 正常触发。
- [ ] 查看发布计划中的 `deploy_apps`：已有基线时，明日方舟独有改动仅包含 `arknights`；终末地前端独有改动仅包含 `endfield`；共享运行代码改动按依赖影响范围选择。构建或检查两站不等于部署两站。
- [ ] 受影响的开发部署成功后，自动创建或复用发布 PR，并启用其 auto-merge。若 main 已包含该版本或两分支内容相同，跳过空发布 PR 属于预期行为。
- [ ] 发布 PR 合入 main 后，生产部署仍等待 Environment 审批；审批完成后仅部署受影响应用。
- [ ] 涉及终末地时，Actions 摘要存在增量传输字节数、耗时和归档 SHA-256；上传校验及安装健康检查成功。

部署基线的权威记录是 GitHub deployments 中任务为 `deploy:arknights` 或 `deploy:endfield` 的应用记录，分别归属 `development`、`production` 环境。不要用通用 Environment 任务成功替代某一应用的成功证据。

**完成条件：** 本次授权范围内的验收项有对应 PR、运行记录和部署结果。未实际覆盖的场景标记为待验证；仅配置开关或本地测试通过不足以证明线上链路成功。

## 异常与恢复

| 现象 | 检查及处理 |
| --- | --- |
| 无权修改设置、安装 App 或保存 Secret | 记录当前身份、具体操作及错误，让有权限的操作者补齐；其余独立步骤继续完成 |
| `Resource not accessible by integration` | 核对 App 安装仓库、权限、安装端权限更新，以及工作流请求的权限；不改用个人令牌绕过 |
| 标签存在但没有触发自动合并 | 核对 main 工作流、两个事件工作流名称、`PR_AUTOMATION_ENABLED`、标签添加者权限和 PR 条件 |
| App 认证失败 | 核对 App ID、完整 PEM、Repository secret 层级和 App 安装；只报告错误，不回显凭据 |
| 一站成功、另一站失败 | 使用 `Deploy previously verified release`，只选择失败的 `application`，提供原质量运行 ID 与当前目标分支的精确 `expected_sha` |
| 旧任务拒绝部署、产物过期或质量门失败 | 查询当前分支和运行状态；按实际原因执行新的完整验证，不强制部署旧提交 |
| 开发重试成功但发布 PR 未推进 | 查 `Release PR automation`；必要时用 `workflow_dispatch` 的 `mode=promote`、原质量运行 ID、当前 develop SHA 恢复；原门禁继续生效 |
| 配置修好后需要重新处理某个 PR | 运行 `Release PR automation`，选择 `mode=automerge` 并填写 `pr_number` |

需要停用时，先处理已经开启的原生 auto-merge，再关闭自动化开关：在处理工作流仍启用时移除对应标签并核实已取消，或直接在 GitHub 取消原生 auto-merge。随后按停用范围把 `RELEASE_PROMOTION_ENABLED`、`PR_AUTOMATION_ENABLED` 设为 `0`。关闭变量不会自动取消既有 PR 上的原生 auto-merge。

## 交付报告格式

按实际证据填写，省略敏感值：

```text
仓库：Closure-RIIC/RIIC-Web
本次授权范围：配置 / 启用 / 发布验证
状态：configured / activated / verified / blocked（选择一项）
原生 auto-merge：开启 / 关闭 / 无权确认
App：App ID、安装仓库、权限是否符合要求
Secret：RELEASE_APP_PRIVATE_KEY 存在 / 缺失（不含明文）
变量：各开关的实际值
远端代码：develop/main 是否已包含新版工作流
证据：相关 PR 链接、Actions 运行链接、各应用部署结果
未验证项目或阻塞：具体操作、错误、所缺权限或配置
受影响 UI：无（仅执行本配置任务时）
```

## 按需参考

- 部署范围、来源校验或重试行为不明确时，阅读仓库的 [Application release automation](APPLICATION_RELEASE_AUTOMATION.md)。
- 排查终末地传输、安装或健康检查时，阅读 [Endfield deployment](ENDFIELD_DEPLOYMENT.md)。
- GitHub 页面字段或权限行为变化时，以官方文档核对：[auto-merge 设置](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository)、[创建 App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)、[安装 App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)、[私钥管理](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)。
