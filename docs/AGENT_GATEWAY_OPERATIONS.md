# Agent 网关与计费运维

## 范围与边界

应用在 `AGENT_GATEWAY_ENABLED=1` 时仅请求 `group/riic-agent`，由 Magpie 按顺序选择模型；配置备用模型后，在前两个模型无响应时最后尝试 `deepseek-flash`。所有调用继续经过网关计量和过滤。`AGENT_GATEWAY_ENABLED=0` 保留原模型选择，供受控回滚使用；两种模式均读取计费管理中已发布的费率与倍率。

`/admin/billing` 提供用量、成本、钱包、流水、爱发电订单、费率、对账、兑换码和操作审计，独占费率与服务倍率的配置职责；`/admin/agent` 提供模型顺序、网关同步状态、版本化过滤规则与命中记录。模型目录只展示型号和角色，未采集路由状态时明确显示状态未确认，不能从费率存在推断线路已启用。两个入口与 API 均要求管理员，reviewer 无权访问。普通 `/billing` 不增加管理入口。

不更改现有积分产品、月卡、兑换码和支付渠道。管理员退款仅退还积分；不发起现金退款。补扣只使用未预留的永久积分。退款不得超过原扣费，按原永久/月卡分桶处理；已过期月卡不会恢复；缺少原分桶证据或月卡有效期已改变时拒绝自动退款，须人工对账，避免错误延长有效期。

## 版本与部署

- Magpie `v0.1.1203`，Linux amd64 镜像：`ghcr.io/yetone/magpie@sha256:871a96aaeed1ea6a6f75767bef6043d4f474aa6ea9d3fe7f25cac9f7fc628d38`。
- 官方多架构 manifest：`sha256:f9fa3eb10bdc0e1a5af094cffbcf002a467dc8fd8da33939bb651e28fe5c8d02`。
- `@magpie-community/middleware-word-guard@0.1.1`（MIT）：入口 SHA-256 `f6bbb2609576b266eaaa71ef5e561268bab99009e6d5cea866903b41bd96550e`。
- Bun `1.4.2`，官方 Linux x64 baseline ZIP SHA-256 `c678040f14fe0440eb839d37cbd0ce4c051a32da72806ac97de6a6aab6bf728f`。
- 生产网关仅绑定 `127.0.0.1:3425`，开发仅绑定 `127.0.0.1:3426`。不增加公网 Nginx 路由。
- 每个环境使用独立容器、配置、网关密钥、用量、数据库与工作进程。应用密钥只允许 `group/riic-agent`。
- 上游密钥只由部署脚本从现有私有环境读取后写入受限网关配置；不提交仓库。原私有配置保留用于回滚。
- 网关配置 `/var/lib/riic-magpie-<environment>`，公开规则派生文件 `/var/lib/riic-agent-<environment>`，应用私有环境 `/etc/riic-agent-<environment>.env`。
- 工作进程 `riic-agent-worker-<environment>.service` 从当前 release 的 `worker/agent-worker.cjs` 启动，读取该 release 的数据库配置。

部署顺序：校验官方依赖 → `deploy/setup-agent-gateway.mjs <environment>`（默认关闭应用开关）→ 安装部署 helper 对第三个 worker 的精确允许项与回滚处理 → 合并开发分支并通过既有 CI 发布、执行增量迁移 → 附加该环境的 systemd EnvironmentFile 并启用网关 → 开发验收 → release 分支进入 main → 生产重复验收。保留所有既有发布门禁；不能用手动替换站点绕过 CI。

`deploy/patch-agent-release-helper.mjs` 只扩展 worker 文件允许项和服务重启/回滚处理，校验预期原文、检查 shell 语法并备份原 helper。没有改变既有鉴权、迁移、产物、健康检查或回滚门禁。

## 调用、过滤与计费

### 备用模型

私有环境文件增加 `AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL=https://api.deepseek.com`、
`AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL=deepseek-flash` 和独立的
`AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY`。密钥仅从受限环境文件派生到网关配置，
各模型使用独立凭据和准确的计量身份。

`deploy/agent-model-source.mjs` 的 `withSupplementalModelSource(config, source)`
生成追加备用模型的配置，保留原两条模型及密钥，并设置 `firstToken=10`、
`queueWait=1`、`patience=-1`。前两条线路在连接、响应头或首内容阶段持续无响应时
切换，角色帧和 keepalive 不算内容。Magpie 每候选 15 秒会提前发送响应头，因此
首内容等待必须小于 15 秒，才能继续使用响应头中的真实模型身份结算。
最后一个候选仍受应用 60 秒首语义输出和整轮 10 分钟限制。
已输出正文、推理或工具内容后不自动重放；`affinity=turn` 会在同一轮工具续调中
沿用已成功的候选，下一用户轮次再恢复优先顺序。

备用模型成本模板按人民币公开价：每百万 token，空闲时段未缓存输入 1 元、缓存输入
0.02 元、输出 4 元；峰时分别 2、0.04、8 元。实际单价和服务倍率以计费管理
已发布版本为准，积分换算及工具费保持原规则。备用模型费率有独立精确 provider/model 行，包含
2026、2027 年国务院假期安排；后续年度在新年之前核对价格并发布带新日历的
费率版本。周末即使调休上班也按空闲价。费率时间仍使用该步调用记录创建时间，
跨峰谷边界且前置上游等待时可能与供应商实际选价时刻存在差异；此计量不是供应商发票。

首次安装打开计费管理只生成待编辑模板，不自动发布费率；管理员必须填写服务倍率并保存、发布后，模型请求才可执行。已有 active 版本与历史账单不会因模板修改而变化。上线顺序为：

1. 通过正常 release 流程发布支持第三模型的源码、web 和计费 worker；在对应 `/etc/riic-agent-<environment>.env` 设置非敏感的 `AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED=1` 并重启 web/worker，启用费率发布保护。web 不需要加载上游密钥；历史两行费率继续可读。
2. 在计费管理从当前 active 创建草稿，保留其余模型、倍率及权益，显式选择添加备用模型费率（模板由 `supplementalModelRate()` 提供），核对后保存并发布新版本。已有倍率不会被模板替换。
3. 等待所有使用旧两行费率快照的运行结束，确认没有遗留预留；期间新运行使用新费率。
4. 备份受限 `providers.json`，使用上述纯配置变换追加备用模型，保持文件权限和 owner，再使网关重新加载；先完成隔离合同测试及小额真实冒烟。

新安装的 `setup-agent-gateway.mjs` 在备用模型变量齐全时可创建第三条线路，默认仍不启用应用流量；已有网关配置不会被安装脚本覆盖。
启用标识为 1 的环境，后台发布/回滚费率时要求备用模型行存在。已有安装须在追加路由前核对该环境 web/worker 的有效启用标识；不能只根据密钥文件存在推断护栏已启用。撤销时先移除备用模型路由，
排空进行中的运行，再将启用标识置 0、重启 web/worker，最后通过版本化操作恢复旧费率。
不覆盖历史运行快照、账本或已结算成本。

积分折算基准为 `1 积分 = 0.1 元`，Token 收费公式为 `四舍五入(上游人民币成本 × 已发布服务倍率 ÷ 0.1, 4)`。例如管理员将倍率设为 1.2 时，成本 0.001302 元扣 0.0156 积分；同轮成功求解一次共扣 1.0156 积分。账本、预留、分桶退款和余额均保留 4 位小数；没有每轮最低 1 积分的 Token 费用。

积分产品仍为 5 元/50 分、10 元/110 分、19.9 元/300 分（月卡 30 天）；套餐赠送不改变积分折算单位。管理员设置倍率时仍需计入套餐赠送对实际收入的影响。

上游单价核对来源：[DeepSeek 人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[Z.AI 美元价格](https://docs.z.ai/guides/overview/pricing)。GLM 默认人民币费率是美元报价按固定 7.2 折算，仍由现有环境变量/版本化费率维护，并非实时汇率。

升级时先等待正在执行的 Agent 请求结束，再执行 `0027_fractional_agent_points` 迁移并重启应用和计费 worker；历史整数余额与已结算流水原值保留，不重新计费。

1. 同源校验、权限、请求体大小、用户速率限制；同一用户最多两个运行，同一对话最多一个。
2. 加载版本化费率和过滤策略。检查用户文本、人格卡、文本附件和历史工具结果；客户端不能提交系统角色或可执行工具状态。
3. 为每步模型请求按有界输入和最大输出预留余额；不足时不请求上游。固定最多 12 步、单步最大 2048 输出 token、整个运行 10 分钟。优先预留有效月卡，再使用永久积分。
4. Magpie word-guard 做二次输入检查；RIIC 过滤包括规范化、零宽字符和跨 chunk 缓冲。工具参数在校验通过前不转发，工具结果也先检查。仅成功的求解工具计费。
5. 从响应头读取实际 provider/model，按精确匹配的费率计费。每步保存独立用量与费率版本，缓存输入只计算一次。Token 费用按上游价格 × 已发布服务倍率，按 1 积分 = 0.1 元折算；同一轮各模型步骤的精确金额先汇总，再四舍五入到 4 位小数积分。旧版直连同样在请求前固定费率快照，运行途中发布新倍率仅影响新请求。成功求解每次另扣 1 积分，失败不扣工具费。预算向上保留 4 位小数，结算后释放多余预留。
6. 完成/取消/异常时幂等结算已确认部分并释放剩余预留。没有有效输出的平台错误不向用户收 token 费。缺失用量、未知模型和预算差异进入对账，不把缺失成本记为零。
7. 工作进程每 30 秒同步策略、导入用量并恢复超过 15 分钟的运行；即使网关不可用也尝试恢复预留。管理员调账始终写审计，不能直接覆盖余额。

基础词库仅含过滤探针和少量明确内容词，管理员可维护最多 500 条词语/有界模式、200 条允许词组。模式只有 `?` 单字符匹配，不开放任意正则。允许词组需要应用层按匹配片段处理；启用允许词时网关二次词表为空，由应用层完整执行。图片语义、意图识别和复杂隐喻不在基础词语过滤的覆盖范围。

Magpie 插件异常会 fail-open，因此应用层过滤是必要防线。网关状态中的 `policyWritten` 表示派生配置已写入，`pluginRuntimeVerified` 不据此推断为成功；部署时需执行过滤探针。发布策略会在后续请求/步骤应用，运行账单仍保留开始时的费率和应用过滤版本。

## 已验证的接口契约

- `X-Magpie-Model` 为 `provider/model`，应用必须去掉与 provider 对应的前缀。
- 上游 SSE 使用 OpenAI `prompt_tokens` 总量；网关用量 API 的 `in` 是未缓存部分，核对时要加 `cache_read`。
- `/v1/magpie/usage/requests` 的 `response_id` 用于与实际调用关联，再校验会话和模型；不凭时间猜测关联。
- 无 token 的失败尝试不一定出现在用量列表，需在每次调用结束读取 `/v1/magpie/route?session=...`。路由尝试和完成用量分开保存，不相加重复计费。
- 路由 API 只返回会话最新请求，因此同一对话串行执行并立即持久化。进程崩溃导致路由明细无法确认时保留待对账，而不是捏造失败成本。
- 上游失败尝试成本通常没有可验证用量，标为未知/平台承担；成本看板明确列出未确认请求，不能视为完整供应商发票。

## 验证与回滚

```text
npm run test:agent-gateway
node scripts/test-agent-billing.mjs            # 明确的隔离 localhost PostgreSQL；自动建库与清理
node scripts/test-agent-billing.mjs --browser  # 同一隔离边界，Node + Playwright
npm run build
npm run worker:build
```

Magpie 合同测试 `scripts/test-magpie-contract.mjs` 使用固定 binary/Bun/plugin 和合成上游，无真实模型费用，验证过滤、实际模型标识、工具流、缓存用量和 429 回退。真实模型冒烟使用小输出上限与临时受限密钥，不修改真实用户余额。

回滚应用前先停止新 Agent 请求并等待现有运行完成；确认预留释放后关闭 `AGENT_GATEWAY_ENABLED`。保留已写账本和增量数据库结构，不做破坏性 down migration。代码回滚使用既有发布 helper；无新 worker 的旧 release 会停止 Agent worker。重新启用时运行恢复任务并检查待对账。

待用户手动验收：管理员桌面/手机访问两个后台；查询、分页、调账确认与错误提示；费率和过滤草稿发布/回滚；普通用户与 reviewer 权限；中英文显示；Agent 自动模型提示与取消/重试；普通 `/billing` 没有管理兑换码按钮。
