# Agent 网关与计费运维

## 范围与边界

应用在 `AGENT_GATEWAY_ENABLED=1` 时提供 `deepseek`、`glm`、`gpt` 三个稳定选择。默认 DeepSeek 请求 `group/riic-agent`，依次使用已就绪的中转 DeepSeek、GLM、官网 DeepSeek；显式 GLM/GPT 使用各自精确线路。每轮冻结允许的实际 provider/model 集合，预占取该集合最高费用，结算使用实际返回线路及开始时费率快照。图片只走 GPT；不向文本线路降级。`AGENT_GATEWAY_ENABLED=0` 保留旧文本直连供受控回滚，两种路径都要求已发布的费率与倍率。

GPT 由独立的 `AGENT_LLM_GPT_{BASE_URL,MODEL,API_KEY}` 配置；不得隐式借用其他供应商密钥。GPT provider 只设置 Magpie 的 `responses` 字段：应用沿用 Chat Completions 接口，Magpie 将图片与工具调用转换成上游 Responses API，再将工具事件和用量转换回应用协议。不要给 `riic-gpt` 同时添加 `chat` 来试探协议，否则可能先产生一次失败调用。

`/admin/billing` 提供用量、成本、钱包、流水、爱发电订单、费率、对账、兑换码和操作审计，独占费率与服务倍率的配置职责；`/admin/agent` 提供模型顺序、网关同步状态、版本化过滤规则与命中记录。模型目录只展示型号和角色，未采集路由状态时明确显示状态未确认，不能从费率存在推断线路已启用。两个入口与 API 均要求管理员，reviewer 无权访问。普通 `/billing` 不增加管理入口。

不更改现有积分产品、月卡、兑换码和支付渠道。管理员退款仅退还积分；不发起现金退款。补扣只使用未预留的永久积分。退款不得超过原扣费，按原永久/月卡分桶处理；已过期月卡不会恢复；缺少原分桶证据或月卡有效期已改变时拒绝自动退款，须人工对账，避免错误延长有效期。

## 版本与部署

- Magpie `v0.1.1203`，Linux amd64 镜像：`ghcr.io/yetone/magpie@sha256:871a96aaeed1ea6a6f75767bef6043d4f474aa6ea9d3fe7f25cac9f7fc628d38`。
- 官方多架构 manifest：`sha256:f9fa3eb10bdc0e1a5af094cffbcf002a467dc8fd8da33939bb651e28fe5c8d02`。
- `@magpie-community/middleware-word-guard@0.1.1`（MIT）：入口 SHA-256 `f6bbb2609576b266eaaa71ef5e561268bab99009e6d5cea866903b41bd96550e`。
- Bun `1.4.2`，官方 Linux x64 baseline ZIP SHA-256 `c678040f14fe0440eb839d37cbd0ce4c051a32da72806ac97de6a6aab6bf728f`。
- 生产网关仅绑定 `127.0.0.1:3425`，开发仅绑定 `127.0.0.1:3426`。不增加公网 Nginx 路由。
- 每个环境使用独立容器、配置、网关密钥、用量、数据库与工作进程。应用密钥允许默认 `group/riic-agent` 和已就绪的精确线路，不开放受管 provider 通配符。
- 上游密钥只由部署脚本从现有私有环境读取后写入受限网关配置；不提交仓库。原私有配置保留用于回滚。
- 网关配置 `/var/lib/riic-magpie-<environment>`，公开规则派生文件 `/var/lib/riic-agent-<environment>`，应用私有环境 `/etc/riic-agent-<environment>.env`。
- 工作进程 `riic-agent-worker-<environment>.service` 从当前 release 的 `worker/agent-worker.cjs` 启动，读取该 release 的数据库配置。

部署顺序：校验官方依赖 → `deploy/setup-agent-gateway.mjs <environment>`（新安装默认关闭应用开关）→ 安装部署 helper 对第三个 worker 的精确允许项与回滚处理 → 合并开发分支并通过既有 CI 发布、执行增量迁移 → 附加该环境的 systemd EnvironmentFile 并启用网关 → 开发验收 → release 分支进入 main → 生产重复验收。保留所有既有发布门禁；不能用手动替换站点绕过 CI。

已有部署升级前先暂停新 Agent 请求并排空运行，再执行配置脚本。脚本增量更新受管 provider；默认 `riic-agent` 组按部署策略重建，仅保留显示名，清除旧动态匹配、分类、禁用等路由控制，避免意外扩展候选集合。移除 provider 级跨模型 fallback，保留无关 provider、group、限额及已有密钥；同步应用 key 对默认组和精确线路的权限，不重新生成 key。首次变更前保留 `.before-model-selection` 私有备份。配置和权限更新后，同步已就绪的 `AGENT_GATEWAY_MODELS`、官网兜底标志及实际型号。DeepSeek 必需，GLM/GPT 可选，官网要求独立完整配置及启用标志。就绪标志不代表上游健康探测或费率核实；还须发布匹配全部候选线路的费率并重启 web/worker。重跑保留 `AGENT_GATEWAY_ENABLED` 状态。

脚本同时在这个供 web/worker 使用的环境文件中同步已就绪模型的 `AGENT_LLM_DEEPSEEK_MODEL`、`AGENT_LLM_GLM_MODEL`、`AGENT_LLM_GPT_MODEL`，保证应用请求、费率身份与网关真实路由一致，支持供应渠道的自定义型号。这里只复制型号，不复制上游地址或密钥；官网型号和启用标志同步维护，GPT 未就绪时不进入可用目录。

Windows 原生本地运行 Magpie 时，给 worker 设置 `AGENT_GATEWAY_POLICY_DIR` 为独立配置中 `plugins.json` 所在的绝对目录，并设置 `AGENT_GATEWAY_PLUGIN_PATH` 为 Magpie 可读取的插件绝对路径，例如 `C:/Users/ray/AppData/Local/Temp/riic-magpie-test-0.1.1203/package/word-guard.middleware.js`。worker 每轮维护仍从已发布过滤策略生成插件规则，并保留此路径；相对路径会使维护失败。`AGENT_GATEWAY_PLUGIN_PATH` 未设置或为空时沿用 Linux 容器路径 `/riic-policy/word-guard.middleware.js`，因此现有部署无须添加该变量。设置路径不代表插件已成功执行，本地启动后仍须验证过滤探针。

模型启停、默认模型、显示名、图片限制与调用费率统一在「计费管理 → 模型费率」中维护；Agent 管理负责人格、知识库、过滤与网关记录。三个公开模型和官网兜底各有费率卡片，共用一套草稿、发布与回滚。公开模型的“允许用户选择”开关仅控制选择器，默认组候选线路由部署就绪配置控制。高峰价格和非高峰日期是所有线路的可选能力，目前两条 DeepSeek 线路使用高峰价；`peak:null` 按无高峰规则解析，不回写历史。升级需在现有邀请活动迁移之后依次执行 `0032_agent_model_selection_and_settings` 和 `0033_agent_cache_write_tokens`，首次访问会记录原有生效组合为可回滚基线；一次事务同时切换模型与费率快照，并比较两个版本防止并发覆盖。旧独立策略 API 仍兼容且同步联合历史。新请求在同一锁内读取配套模型与费率，在途请求保留开始时的快照。

GPT 初始禁用，费率草稿提供中转 DeepSeek、GLM 和官网 DeepSeek 模板，倍率留空且不自动发布。管理员在 GPT 卡片内添加单价、配置图片预算模式与图片限制并启用，然后统一保存草稿和发布。缺省 `per-image` 模式要求供应商确认的每张图片 token 上限 `imageTokensPerImage`，为 0 时阻止启用；显式 `shared-input-limit` 模式在每次含图模型调用中为全部图文预留统一的 262144 输入 token 上限，此时每图字段不参与计算、可以为 0，工具续轮会重新计量和预留。无图调用仍按文本估算；两种模式均按真实 usage 结算，超预留进入复核。共享模式是管理员选择的预留策略，不代表供应商图片用量保证。生产费率须核对供应商实际价格；本地测试的自定义费率不能据此宣称实际供应成本。

图片经过应用规范化为最大 2048×2048 的 PNG，并受字节数、像素数及张数限制。当前固定 Magpie 的 Chat→Responses 转换不保留 `detail`，上游使用默认图片 detail；`per-image` 模式的供应商确认上限必须覆盖这种实际请求形态。环境中包含 `gpt` 不能绕过线路、费率、预算模式与图片限制的启用条件。

图片限制用于控制上传体积和解码开销，不作为 Token 单价：默认每图 8 MiB（8388608 字节）、16 百万像素（1600 万，宽×高）。后台使用 MiB/百万像素显示，存储仍是整数的字节数/像素数。原图先通过字节与像素校验，再等比缩小至最长边 2048；生成的 PNG 还需满足同一字节上限。24/48 MP 等高像素原图应先缩小分辨率；降低 JPEG 文件体积不一定降低像素数。整段对话另受总大小限制，单图上限不代表可以同时上传四张达到上限的图片。

GPT 卡片可录入按总输入 token 分档的普通与高峰单价。当前供应商规则的阈值为 272000：严格超过时，整次模型调用的输入/缓存读取/输出分别按高档单价结算，恰好等于阈值仍用基础档。新增高档可根据基础价格按 2 / 2 / 1.5 倍填入，后续直接编辑单价；币种、汇率、服务倍率由两档共享。此规则显式保存在新发布费率版本中，不回写历史账单。当前输入预留硬上限仍是 262144，供应商报量超预算仍进入复核，不因新增价格档位而放行。

计费概览、Agent 对话调用记录与网关请求页显示按实际 provider/model 汇总的调用次数、总输入、缓存读取、输出、已知成本、计价金额、长上下文次数、未确认记录及待复核调用。输入已包含缓存，不能再把缓存加到输入总量。概览按调用时间和日期统计；对话/网关页按本页完整筛选范围统计而非当前分页。网关通过 call_id 关联完成用量，汇总按调用去重；多次 attempt 共用整次调用数据，不虚构每个失败 attempt 的分摊成本。详情展示按原始 run.policy 判断的档位，未知费用保持空值，模型计价金额不等于最终钱包扣点。待复核次数只依据尚未关闭的复核记录。

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
切换，角色帧和 keepalive 不算内容。该等待值控制回退时延，不作为计费身份可靠性的前提。
应用固定请求 `X-Magpie-Response-Model: member`，从 SDK 响应元数据读取实际
`provider/model`，再核对本轮冻结的候选集合与费率快照。Magpie 的保活机制可能
在候选尚未确定时提前发送 HTTP 身份头，因此这些头不用于确定结算线路。
缺失、未知或歧义的响应身份进入待对账；合法身份在后续断流或取消时保留。
最后一个候选仍受应用 60 秒首语义输出和整轮 10 分钟限制。
已输出正文、推理或工具内容后不自动重放；`affinity=turn` 会在同一轮工具续调中
沿用已成功的候选，下一用户轮次再恢复优先顺序。

备用模型成本模板按人民币公开价：每百万 token，空闲时段未缓存输入 1 元、缓存输入
0.02 元、输出 4 元；峰时分别 2、0.04、8 元。实际单价和服务倍率以计费管理
已发布版本为准，积分换算及工具费保持原规则。备用模型费率有独立精确 provider/model 行。
代码模板不预填非高峰日期；管理员在运行中的计费管理后台填写日期并发布费率版本。
已有版本中的日期保留，代码更新不会清空或覆盖。周末即使调休上班也按空闲价。费率时间仍使用该步调用记录创建时间，
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
5. 从流中的 member 元数据读取实际 provider/model，校验冻结的候选线路和费率后计费。每步保存独立用量与费率版本，缓存输入只计算一次。Token 费用按上游价格 × 已发布服务倍率，按 1 积分 = 0.1 元折算；同一轮各模型步骤的精确金额先汇总，再四舍五入到 4 位小数积分。旧版直连同样在请求前固定费率快照，运行途中发布新倍率仅影响新请求。成功求解每次另扣 1 积分，失败不扣工具费。预算向上保留 4 位小数，结算后释放多余预留。
6. 完成/取消/异常时幂等结算已确认部分并释放剩余预留。没有有效输出的平台错误不向用户收 token 费。缺失用量、未知模型和预算差异进入对账，不把缺失成本记为零。
7. 工作进程每 30 秒同步策略、导入用量并恢复超过 15 分钟的运行；即使网关不可用也尝试恢复预留。管理员调账始终写审计，不能直接覆盖余额。

基础词库仅含过滤探针和少量明确内容词，管理员可维护最多 500 条词语/有界模式、200 条允许词组。模式只有 `?` 单字符匹配，不开放任意正则。允许词组需要应用层按匹配片段处理；启用允许词时网关二次词表为空，由应用层完整执行。图片语义、意图识别和复杂隐喻不在基础词语过滤的覆盖范围。

Magpie 插件异常会 fail-open，因此应用层过滤是必要防线。网关状态中的 `policyWritten` 表示派生配置已写入，`pluginRuntimeVerified` 不据此推断为成功；部署时需执行过滤探针。发布策略会在后续请求/步骤应用，运行账单仍保留开始时的费率和应用过滤版本。

## 已验证的接口契约

- 请求设置 `X-Magpie-Response-Model: member`，响应流的 `model` 为实际 `provider/model`；应用先与冻结线路精确匹配，再使用对应费率。HTTP `X-Magpie-Model` 可能早于兜底确定，仅作诊断。
- 上游 SSE 使用 OpenAI `prompt_tokens` 总量；网关用量 API 的 `in` 是普通输入，核对时要加 `cache_read` 和 `cache_write`。旧网关遥测在重新导入时可补齐这些计数，不改写历史调用费用。
- GPT Responses 的 `input_tokens` 经 Magpie 转换为 `prompt_tokens`，包含图片输入；`input_tokens_details.cached_tokens` 和 `cache_write_tokens` 是其中的缓存读取、写入子集，不可再次计入总输入。`output_tokens` 已包含推理 token 时也不得叠加推理明细。图片详情只有上游确实提供时才能记录为实测；base64 长度不等于图片 token。
- 每条线路可在模型费率中开启“单独计算缓存写入”，填写基础档及已启用高峰、长上下文各档的写入价，再保存发布。未开启的版本继续原计费公式；开启后普通输入量为总输入减缓存读写量，四项分别计价，预扣纳入写入最高价。后台不自动猜测供应商写价，也不修改既有生效策略。
- 写入用量由 SDK 原始 usage 提取；缺失时为“未记录”，明确零才是零。启用写入计价但未取得该计数的调用进入待对账；历史未记录用量不回填零或重计价。固定 Magpie 会把上游缺失写入字段归一化为零，因此启用前仍需确认供应商的报量契约。
- 首版仅使用当前供应商默认缓存时长（GPT 为 30 分钟）。固定网关不完整保留 GPT 12 小时写入明细，后台不提供时长切换。上线先执行 `0033_agent_cache_write_tokens`（两项可空列，无历史回填），再更新网站与 Agent worker。
- `/v1/magpie/usage/requests` 的 `response_id` 用于与实际调用关联，再校验会话和模型；不凭时间猜测关联。
- 无 token 的失败尝试不一定出现在用量列表，需在每次调用结束读取 `/v1/magpie/route?session=...`。路由尝试和完成用量分开保存，不相加重复计费。
- 路由 API 只返回会话最新请求，因此同一对话串行执行并立即持久化。进程崩溃导致路由明细无法确认时保留待对账，而不是捏造失败成本。
- 上游失败尝试成本通常没有可验证用量，标为未知/平台承担；成本看板明确列出未确认请求，不能视为完整供应商发票。

## 验证与回滚

```text
npm run test:agent-gateway
node --test deploy/agent-model-gateway-config.test.mjs
node scripts/test-agent-billing.mjs            # 明确的隔离 localhost PostgreSQL；自动建库与清理
node scripts/test-agent-billing.mjs --browser  # 同一隔离边界，Node + Playwright
npm run build
npm run worker:build
```

Magpie 合同测试 `scripts/test-magpie-contract.mjs` 使用固定 binary/Bun/plugin 和合成上游，无真实模型费用。除既有过滤、实际模型标识和旧组 429 回退契约外，还验证显式模型 429 不转备用，GPT 只访问 Responses 上游，图片 data URI 与工具参数透传、函数调用事件转换、总输入/缓存/输出统计、用量导入及取消关闭上游。可设置 `MAGPIE_TEST_BINARY`、`MAGPIE_TEST_PLUGIN`、`MAGPIE_BUN` 后运行；使用隔离的配置、缓存、数据目录，不读取本机已登录模型账号。

固定版本的依据是官方源码 tag `v0.1.1203`（commit `6c1c0a7472f98a8ae197de84708530bd1a47ad31`）：[`Provider.responses`](https://github.com/yetone/magpie/blob/v0.1.1203/internal/provider/provider.go) 定义原生 Responses base URL，[GPT 工具协议测试](https://github.com/yetone/magpie/blob/v0.1.1203/internal/gateway/tools_need_responses_test.go) 覆盖 GPT‑6.1 Sol 的工具调用。合同可验证网关转换，但不能证明供应商已开通该模型、图片质量或真实费率。真实模型冒烟另使用小输出上限与临时受限密钥，不修改真实用户余额。

Magpie `prompt.go` 的通用图片估计是参照 Anthropic 的 1600 token，不是 GPT‑6.1 Sol 的可靠计费公式；它的 `/v1/messages/count_tokens` 在无 Anthropic 原生计数时也可能返回粗估，不能当作 GPT 图片实测。图片预算必须遵循应用的模型能力/预算策略；最终仍按真实 usage 结算，缺失用量保持待对账。

回滚应用前先停止新 Agent 请求并等待现有运行完成；确认预留释放后关闭 `AGENT_GATEWAY_ENABLED`。保留已写账本和增量数据库结构，不做破坏性 down migration。代码回滚使用既有发布 helper；无新 worker 的旧 release 会停止 Agent worker。重新启用时运行恢复任务并检查待对账。

待用户手动验收：管理员桌面/手机访问两个后台；查询、分页、调账确认与错误提示；费率和过滤草稿发布/回滚；普通用户与 reviewer 权限；中英文显示；三模型选择、取消/重试与 GPT 图片请求；普通 `/billing` 没有管理兑换码按钮。
