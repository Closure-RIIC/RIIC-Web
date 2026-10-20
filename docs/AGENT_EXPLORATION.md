# Agent 探索原型（可露希尔助理）

实验性的 agent 入口：把站内既有功能工具化，让大模型在对话中编排账号诊断、排班求解、技能查询与知识库检索，输出整体方案。本文记录架构、配置与后续路线。

## Agent 知识与能力接入（2026-09-22）

- `RIIC-knowledge/agent/KNOWLEDGE_RULES.md` 是共享知识规则唯一真源。网站通过 `knowledge-policy.ts` 加载；独立入口通过 `agent/load-policy.mjs` 展开 SYSTEM_PROMPT 模板。网站不注入独立 RAG 的 context/question 模板。
- 外部人格卡保持身份与语气职责，宿主明确知识规则和工具编排优先级，不修改外部角色内容。网站就是 riic.autos，可由本地工具完成的直接调用，产品使用问答、MAA 配置及账号支持按具体能力处理。
- 所有技能查询固定 `query_skills → kb_route → kb_read`：先游戏原文与解锁条件，再隐性释义；用法、组合与培养正文按需读取。成功检索没有特殊释义时按原文正常答，不声明检索情况；工具故障只说明相关限制，不能声称没有规则。
- `query_skills` 复用网页 `operatorBuildingSkillList` 与搜索能力，支持干员名/id、英文与拼音，返回持有者与解锁练度。`diagnose_account({operators:[...]})` 复用已加载干员池，返回指定干员 own/elite/level；示例池与未知名称为 null；森空岛完整持有列表中缺少的已知干员为 false，MAA 部分上传中未出现条目保留未知。
- `load_agent_skill` 从 KB manifest 白名单按 id 加载 1/3/4/6/7；模型可自主组合。2/5/8 仍为未接入草稿，现有工具没有通用产出诊断/回本计算接口，相关问题只引用既有结论或定性说明。
- 简单排班、专精、公招不查机制 KB、不加载 skill；排班保留既有预览确认。知识卡片只显示友好状态与查询对象，如“技能查询 完成 · 巫恋”“知识库阅读 完成《违约索赔》”，不展开路径、检索覆盖或原文片段。`output.error` 与 `output-error` 统一只显示一次失败信息，知识错误使用友好提示避免泄漏内部诊断。
- 专精身份在筛选资格前解析：完整规范名/ID 优先，其他名称合并站内名称、英文/拼音及 KB `operator_aliases` 的候选。只读别名索引，不触发技能/机制知识两阶段查询；多候选让用户选。别名索引不可用时，非规范名候选须确认，完整名仍可计算。
- `calculate_mastery` 内置解析；目标等级缺失时可先 `resolve_operator` 核实身份和资格，再只问必要参数。提示词要求先查站内数据，不凭跨作品记忆拒绝；“那某某呢”继承上文专精起止等级。
- 分层失败码：`identity_unknown` / `identity_ambiguous` / `not_owned` / `ownership_unknown` / `insufficient_training` / `calculation_unsupported`。复用网页资格及短 ID 归一化；森空岛缺失视为未持有，MAA 未出现条目保留未知，示例池不推断个人持有。
- 已核实目录收录结城理（`char_4217_makoto`），示例池具备计算资格。现有 KB 字典及其来源“歧义-简称合称”明确：维娜/异格推王→维娜·维多利亚，推王→推进之王；不额外制造候选，也不修改 KB 事实。
- 专精环境卡片按来源合并，逐项保留数值与零值，例如“默认：人间烟火 0；森空岛自动读取：萨米 1、深海猎人 0；用户指定：骑士 0”。正文简要概括，详细参数与快照时间见卡片。
- 正文每页 16K 字符，返回 nextOffset 供续读；仅允许 docs 下 Markdown，标题缺失返回“知识正文”。
- 测试：`node --test --experimental-strip-types src/server/agent/knowledge-tools.test.ts src/server/agent/calculator-tools.test.ts src/components/agent/AgentChat.test.mjs src/mastery.test.ts`。设置 `AGENT_TEST_KB_DIR` 可额外验证真实 KB 身份别名、独立/网站同源加载和白名单（未设置时跳过真实库项）。本轮 28 项离线测试通过，覆盖分层失败、精确名优先、多候选、真实别名、环境零值及来源、卡片实际渲染与两种错误状态；ESLint 与排除旧 Next 生成缓存后的源码类型检查通过。全量类型检查仍被已有 `.next/types/validator.ts` 引用缺失的 `demo-notice-run/route.js` 阻挡。本次没有调用付费模型；提示词测试验证规则装配，不能替代模型多轮行为验收。

## 本次实验更新（2026-09-21）

- 在原有 Agent 实验中加入专精训练、公招词条工具，复用网页计算核心，提供聊天结果卡片。
- 专精先计算后汇报条件：默认未专精起步、换人余量一分钟；公招收到一至五个词条直接计算，默认九小时。
- 专精接通森空岛进驻快照到六类环境人数与中枢加成，手动指定值优先，缺少快照时沿用默认值；结果标明来源与时间。
- 干员相关术语统一为“账号／干员池”；页面模型信息仅显示模型名称。
- 25 项工具及计算测试通过；改动文件 ESLint 和排除旧 Next.js 生成缓存后的源码类型检查通过。已在真实账号对话中验证自动环境读取、专精计算和结果反馈。
- 待完善：模型传入字符串等级（例如 target="3"）仍会触发参数校验错误；OCR 仅记录接入设计，尚未实现；人间烟火与加工站进驻覆盖仍为实验限制。

## 仓库边界（重要）

本仓库（RIIC-Web）只包含 agent 的**编排代码与工具定义**。运行时依赖的两类外部内容不随本仓库分发：

| 内容 | 位置 | 接入方式 |
|---|---|---|
| 基建知识库 | 外部仓库 [RIIC-knowledge](https://github.com/lejciy/RIIC-knowledge)（markdown 语料 + 索引） | 克隆到本地后，用 `AGENT_KB_DIR` 指向仓库根目录；`kb_route`/`kb_read` 工具按需读取 |
| 人格卡 | 独立的 person-card 仓库（不公开分发） | 克隆后用 `AGENT_PERSONA_CARD` 指向卡片文件（如 closure.md）；未配置时自动回退为中性的助理语气 |

模型接入（DeepSeek / GLM，OpenAI 或 Anthropic 兼容协议）通过 `AGENT_LLM_*` 环境变量配置，密钥只存在于本地 `.env.local`。

## 架构

```
/agent 聊天页面（src/app/agent/page.tsx + src/components/agent/AgentChat.tsx）
  useChat + DefaultChatTransport，工具调用渲染为站内卡片
        ↕ SSE（UIMessage 流）
/api/agent/chat（src/app/api/agent/chat/route.ts）
  better-auth 会话校验 → 系统提示词 → streamText 工具循环（stopWhen 12 步）
        ↓ 服务端进程内直调（传 userId，不透传任何凭证给模型）
工具层（src/server/agent/tools.ts，Zod inputSchema）
  diagnose_account / preview_solve_defaults / solve_schedule / calculate_mastery / calculate_recruitment / query_skills / kb_route / kb_read
        ↓
站内既有服务：skland adapter、runPlan 求解器、arkntools 技能目录、RIIC-knowledge 文件库
```

分层文件：

| 文件 | 职责 |
|---|---|
| `apps/arknights/src/server/agent/config.ts` | AGENT_* 环境变量（provider 预设 deepseek/glm、base URL、model、key、知识库路径） |
| `apps/arknights/src/server/agent/llm.ts` | `@ai-sdk/openai-compatible` provider 工厂，两家厂商同一通道 |
| `apps/arknights/src/server/agent/persona.ts` | 外部人格卡加载 + 同源知识规则 + 宿主工具编排 |
| `apps/arknights/src/server/agent/knowledge.ts` | 知识库访问器：标题清单索引检索、正文读取（路径白名单防越界，16K 分页续读） |
| `apps/arknights/src/server/agent/tools.ts` | 工具注册、干员池来源解析、结果投影、审计日志 |
| `apps/arknights/src/server/agent/calculator-tools.ts` | 专精训练、公招词条工具参数与共享计算核心适配 |

## 工具清单

专精、公招和账号诊断的干员池按森空岛 → MAA 上传 → 全精二示例兜底，返回来源信息。示例池不代表用户实际持有；公招此时仍计算组合，个人拥有状态为未知。专精返回简单/快速两种方案及与网页共用的操作时间线。干员持有和练度称为“干员池”；“库存”保留给真实仓库资源与设施存量。

新增工具测试已纳入 `npm test`，也可单独执行 `node --test --experimental-strip-types src/server/agent/calculator-tools.test.ts`。

| 工具 | 数据源 | 说明 |
|---|---|---|
| `calculate_mastery` | `calculateMastery` + `masteryInstructions` | 干员、专精起止等级、中枢加成、操作余量和环境参数；返回两种方案及换人时间线 |
| `calculate_recruitment` | `calculateRecruitment` | 最多五个词条、招聘时间、四星及缺失筛选；返回词条组合和候选干员 |
| `preview_solve_defaults` | 账号、排班历史与场景默认配置 | 排班前预览实际采用的配置 |
| `diagnose_account` | `readSklandAccountStore` + `loadStatusSnapshot` + `listSavedPlans` | 森空岛绑定/玩家信息/干员池练度统计/当前基建/最近排班 |
| `solve_schedule` | `buildBlueprint`/`updateFactoryRecipe` + `runPlan`/`getSampleOperbox` + `toPublicPlanData` | 真实求解：布局预设、box 来源、换班节奏、制造站配方（搓玉配 originium）；返回排班、日产出、练卡建议 |
| `query_skills` | `apps/arknights/src/generated/arkntools/building-skill-catalog.json` | 干员名/id、技能名/关键词/标签查询，复用网页技能原文及解锁练度 |
| `kb_route` | `RIIC-knowledge/index/标题清单.md` | 关键词→候选文档路径（2-gram 匹配扩大召回） |
| `kb_read` | `RIIC-knowledge/docs/**` | 读正文，仅限知识库目录内 .md |

## 专精与公招路由

- 专精已知目标干员和目标等级即计算，起始等级省略按 0，明确“从专X开始”按 X；中枢与六类环境人数优先读取森空岛快照，用户指定值优先；无快照时中枢默认 +5%、环境全 0，换人余量 1 分钟。先输出方案，末尾根据返回的 settings 汇报条件和来源。调整时保留未改变的参数。
- 公招提供一至五个词条即可计算，默认九小时；未提供词条才追问具体词条，不要求补齐五个。

## 环境读取实验与后续接口

- 基建环境映射已接入：mastery-environment.ts 从同一次森空岛完整快照读取进驻名单，对照术语成员表映射六类人数，包括宿舍和训练室、按 ID 去重、排除推断的加工站。中枢按实际进驻者已解锁技能判断 +5%。工具返回命中名单、采用值、来源和快照时间；用户明确的 0/false 优先。人间烟火未自动推导，未指定按 0。卡片和 Agent 反馈统一简要提示“自动读取状态可能存在误差或延迟，如果环境加成变动，记得跟我说哦。”，详细限制在用户追问时解释。
- 公招截图 OCR：预留独立识别适配边界，建议输入上传图片引用，输出候选词条名称、置信度及未识别项；校验 RECRUITMENT_TAGS 后将一至五个有效词条传给现有 calculate_recruitment。低置信度候选需澄清，识别失败则请求文字词条。当前没有上传/OCR 实现、模型可调用 OCR 工具或外部识别请求。

## 配置

`riicweb/.env.local`：

```
AGENT_LLM_PROVIDER=deepseek   # 或 glm
AGENT_LLM_API_KEY=<真实密钥>
# 可选：AGENT_LLM_BASE_URL / AGENT_LLM_MODEL 覆盖预设
AGENT_KB_DIR=E:/arknights-infra-project/RIIC-knowledge
```

填好 key 重启 dev 服务后访问 `/agent`。key 未配置时页面显示填写引导，站点其他功能不受影响。

## 安全模型

- 工具全部在服务端进程内以用户身份执行，模型只见工具名与 JSON 参数，接触不到 session、森空岛凭证或数据库连接。
- `solve_schedule` 是唯一消耗类工具：人格守则要求调用前向用户确认布局与 box 来源。
- 每次工具调用输出结构化审计日志（`agent_tool_call`：userId、工具名、参数摘要、耗时、成败）。
- 知识库读取做了路径越界防护。

## 搓玉场景（验收路径）

用户："我想搓玉，不知道怎么搞" →

1. `preview_solve_defaults({scene:"orundum"})` 获取默认配置并向用户确认；
2. 用户确认或调整后调用 `solve_schedule`，复用已有工具默认值；
3. 回复排班与业务结果。用户额外询问技能或机制时再按知识路由读取正文，不主动展开长篇 KB 解释。

## 已验证 / 待验证

已验证：TypeScript 与 eslint 通过；知识库检索精准命中搓玉相关文档且路径越界被拦截；`/agent` 页面渲染；未登录 POST 返回 AIC-AUTH-2008；`runPlan` 求解链路回归（243+示例 Box，3 班，约 4.5 秒）。

待验证（需填入真实 API key）：多轮对话、工具编排正确性、搓玉场景全链路对话。

## 结果验收链路（工作台注入为主，已实现）

核心思路：agent 的排班结果不另起炉灶，而是**注入现有工作台**，班次切换、手动排班导入、效率视图等全部现有功能即刻可用。

- `solve_schedule` 求解后把「精简投影 + 完整工作台会话（完整求解结果、布局、box、换班参数）」落库 `app.agent_plan_artifact`（7 天 TTL，仅本人可读，v2 结构）。
- 交接通道（`apps/arknights/src/agent-artifact-bridge.ts`）：
  - **跨页面**：聊天卡片"在工作台中打开"→ sessionStorage 交接 + 跳转 `/` → 工作台启动时自动注入；
  - **同浏览器已开标签**：聊天页在求解完成时经 `BroadcastChannel("riic-agent")` 广播 → 工作台顶部横幅提示，一键注入。
- 注入实现（`App.tsx` 的 `applyAgentArtifact`）：拉取 `GET /api/agent/plan/<id>`（登录鉴权）后复用会话恢复路径（同 `loadPersistedSession`）设置 preset/layout/operbox/boxSource/rotation/fiammetta/result/activeShift 全部状态，并自动切到计算器页；注入结果经既有持久化机制写入 localStorage，刷新不丢。
- `/plan/<id>` 只读结果页保留作为轻量查看/分享入口（含班次切换），不再是主路径。
- 主动覆盖保护：广播路径只弹横幅不自动注入（避免覆盖正在编辑的状态）；聊天页点击"在工作台中打开"视为明确意图，自动注入。

## 页面实时刷新（方案 4，演进路线）

已落地：BroadcastChannel 同浏览器通知 + sessionStorage 跨页交接（见上）。后续：

1. **PostgreSQL NOTIFY → SSE（正式跨端方案）**：站内已有 LISTEN/NOTIFY 设施（plan worker 唤醒机制）与常驻进程部署（systemd standalone），可直接复用。agent 落库后 `NOTIFY agent_plan`；新增 `GET /api/agent/events` SSE 端点：per-connection LISTEN、按 userId 过滤（通知 payload 只带 artifact id，客户端收到后再拉取鉴权资源）；工作台用 `EventSource` 订阅，断线自动重连。需要处理连接注册表、25s 心跳注释行防代理超时、dev HMR 下的连接重置（生产无碍）。接入点已预留：把横幅的数据源从 BroadcastChannel 扩展为 BroadcastChannel + SSE 双通道即可。
2. **轮询兜底**：页面 15–30s `GET /api/agent/plan/latest`（ETag/304），作为 SSE 的降级。
3. WebSocket 不建议：单向通知场景 SSE 足够，custom server 注入 ws 会增加部署复杂度。

## 二期路线（工程化调研结论）

1. **会话持久化**：参照 Vercel ai-chatbot 的 Drizzle 会话表设计，聊天历史落库。
2. **工具审批**：AI SDK `toolApproval`，把 solve 等消耗类工具升级为显式人工确认。
3. **MCP 外部化**：用 `@modelcontextprotocol/server` v2 把同一批 Zod 工具挂成 Streamable HTTP MCP server（OAuth 2.1 Resource Server），让用户在 Claude/Cursor 等客户端查询自己的基建数据；内部工具定义与 MCP schema 共享。
4. **知识库检索增强**：已接消歧字典与长文续读；后续可加入导诊表与小节级定位。
5. **观测**：工具调用审计日志接入管理端指标（复用 plan-run/solver-metrics 模式）。

主要参考：Vercel AI SDK v7（tool loop / UIMessage parts）、assistant-ui（可替换的聊天 UI 层）、Vercel ai-chatbot（会话持久化与 artifacts 模式）、MCP 2025-11/2026-07 规范（Streamable HTTP、OAuth 2.1、异步 Tasks）。

## 维护备注

- 人格卡内容存放于独立的 person-card 外部仓库（不随本仓库分发），以 `AGENT_PERSONA_CARD` 指向的本地文件为真源；上游改动后同步该文件即可（60 秒缓存）。
- 可选预设：`AGENT_PERSONA_SILVERASH_CARD` 指向私有银灰 Markdown，`AGENT_PERSONA_EXUSIAI_CARD` 指向私有能天使 Markdown，`AGENT_PERSONA_SAILEACH_CARD` 指向私有琴柳 Markdown，`AGENT_PERSONA_MOUNTAIN_CARD` 指向私有山 Markdown（均为 UTF-8，非空且不超过 36 KB）。可读取时出现在 Agent 人格选择器中；前端仅保存预设 ID，正文由服务端加载，不随前端包分发。未配置或文件失效时不能以该预设发起请求，可切回默认人格。上传的人格卡仍保存在当前浏览器，切换预设不会删除上传内容。
- 银灰使用灰白毛绒雪豹头像，圆耳前白后灰、稀疏豹纹、后半圈深灰毛领；蓝色复用月卡主题。能天使参考苹果乐：亮红毛绒身体、奶油色脸、遮住一只眼的稍深红色的侧分刘海、金黄单眼与小笑嘴。脸部和刘海绘制在同一球面上，毛区用纹理遮罩控制，避免侧视出现悬空面片；头后方是摆正、加粗的鲜黄至淡黄渐变圆光环，双翼每侧由三枚分开的悬浮黄白渐变菱形组成。页面主题与可露希尔共用红色，切换默认可露希尔也同步应用红色。
- 琴柳以本体立绘的浅金发、浅蓝眼、灰蓝弯角、深蓝头巾和侧辫为锚点，简化成金色圆球毛绒头像：眼睛直接位于毛绒身体上，没有独立脸部色块和嘴巴；头巾绘有菱形网格，带分节起伏的双角从后脑贴着球面向前延伸，尖端略收向内侧。使用网站黄色主题。语气卡依据 [PRTS 档案](https://prts.wiki/w/琴柳)和[语音记录](https://prts.wiki/w/琴柳/语音记录)，以称呼博士、温和坦诚而坚定为核心。
- 山依据 [PRTS 基础档案](https://prts.wiki/w/山)和[基础语音](https://prts.wiki/w/山/语音记录)，采用加入罗德岛后的阶段：称呼博士，沉稳有礼而坦率，避免将战斗喊话或后续模组结局混入日常语气。头像参考站内本体立绘头像，简化为灰白圆球、黑色虎纹、小圆耳、蓝灰眼和环纹卷尾，页面复用月卡蓝色。脸部与虎纹随球面转动，不使用悬空面片。
- 毛绒造型是产品定制，不是官方形象设定。五个角色共用单个 WebGL 渲染器，按需创建模型；历史消息使用 2D 拷贝，保留离屏暂停、减少动态效果与 SVG 降级。
- 部署新增预设时，将 Markdown 放入服务器的私有资源目录并配置对应环境变量，重启应用；无需把本地绝对路径或人格正文提交到公开仓库。未部署私有文件的环境不会展示该预设。
- 知识库是外部仓库 [RIIC-knowledge](https://github.com/lejciy/RIIC-knowledge)，以 `AGENT_KB_DIR` 指向本地克隆；部署环境需要各自克隆并配置路径。
- `scripts/agent-knowledge-smoke.mts` 是知识库工具的冒烟脚本（需配置 AGENT_KB_DIR，仅本地诊断用）。
