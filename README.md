# 可露希尔基建终端

面向《明日方舟》玩家的基建排班 Web 应用。导入干员数据、配置基建布局后，应用会调用独立的 `infra-cli` 求解服务生成三班排班，并提供效率概览、练卡建议和 MAA JSON 导出。

- 在线地址：[riic.autos](https://riic.autos)
- 前端仓库：[KnightCodeSquareMatrix/RIIC-Web](https://github.com/KnightCodeSquareMatrix/RIIC-Web)
- 问题反馈：[GitHub Issues](https://github.com/KnightCodeSquareMatrix/RIIC-Web/issues)

本仓库只包含 TanStack Start 应用、API 边界和协议适配，不包含排班搜索算法、干员技能数据逻辑或求解器源码。

框架切换、验证结果与部署目录升级见 [TanStack Start 迁移记录](docs/TANSTACK_START_MIGRATION.md)。

## 功能

- 导入 MAA `Arknights_OperBox_Export.json` 和兼容的一图流 XLSX / XLS；Box、布局、手动排班和后台复现文件均先打开上传弹窗，可拖入文件或点击“选择文件”，并显示支持格式和已有大小限制。选择后自动接续原流程，保留异常练度审阅、手动草稿覆盖确认和后台预览；失败或取消不会替换当前数据
- 匿名用户可直接载入全角色样例并生成可浏览的示例排班，无需登录
- 配置 243、153、333、252、342 等基建布局与设施等级
- 生成三班排班，查看房间效率、换班调整和预计日产出
- `development` 发布通道可从侧栏新建 1–12 班的手动排班，选择执行后自动进入下一班的顺序轮换，或按分钟设置连续覆盖 24 小时的时间区间；支持逐房安排干员、按班选择菲亚梅塔换心情目标、处理重复进驻，并可导入或导出 MAA 排版 JSON。导入时会保留 Box 外干员、按文件更新明确提供的设施，并展开重复使用的非连续时间计划；已有求解结果也可通过“手动修改排班”转为草稿继续编辑。`production` 的 `/manual` 暂时显示“手动排班待开发”，不会加载编辑器
- 登录网站账号后，在同一布局下假设干员持有或精英化变化，对比完整试算排班且不覆盖当前 Box 或班表
- 按练度与基建收益查看练卡建议
- 从当前 Box 中选择已拥有的精二干员，生成单技能专精的省操作／极速方案和换教官时间表；样例 Box 可匿名使用，个人 Box 需登录网站账号
- 查询基建技能与适用设施，并按干员星级、职业、工作房间和技能标签组合筛选
- 对比当前进驻与排班计划，并导出 MAA JSON
- 可选的森空岛扫码或凭证导入授权、状态同步、网站账号和云端工作区
- 管理员可在独立页面管理用户、按设施审阅和批量删除反馈，并查看失败求解所需的复现资料

森空岛、网站账号和云同步都由部署者显式配置。未启用这些能力时，样例数据、布局配置、技能查询和已接入求解器的排班流程仍可独立使用。

在 `development` 发布通道中，样例 Box 可以匿名用于手动排班；个人 Box 的手动排班需要先登录网站账号。手动排班草稿只保存在当前浏览器中，清除本地数据时会一并删除。两个发布通道的 `/manual` 文档响应都使用 `no-store`，避免浏览器复用其他版本或通道的页面。

## 排班队列与提交限制

登录账号提交的排班任务会写入持久化队列，刷新页面后仍可继续查询。排队与执行中的任务全站最多 1,000 个，其中注册未满 24 小时的新账号最多占用 600 个；达到任一上限后，任务进入最多容纳 2,000 个任务的候选环。活动名额释放时，系统会从仍符合账号和网络限制的候选任务中随机抽取，因此候选环不保证先到先得。

- 同一账号只能保留一个候选、排队或执行中的任务。
- 同一网络最多同时占用 100 个活动名额。
- 每个账号在 10 分钟内最多启动 10 次排班，同一网络最多启动 200 次。
- 页面会自动更新候选、排队和执行状态。出现 `AIC-PLAN-3006`、`AIC-PLAN-3007` 或 `AIC-PLAN-3008` 时，请等待页面倒计时结束后再提交，不要连续点击生成。

任务 API 的状态与重试字段见 [Frontend Serve Guide](./docs/FRONTEND_SERVE_GUIDE.md#persistent-task-admission)。

## 技术栈

- TanStack Start 16 App Router
- React 19 与 TypeScript
- use-intl 与 ICU 消息格式
- Tailwind CSS 4、shadcn/ui、Base UI
- Better Auth、Drizzle ORM 与 PostgreSQL
- `skland-kit`，仅用于可选的森空岛扫码或凭证导入授权
- 外部长驻进程 `infra-cli serve`；生产排班 Worker 用中央调度器驱动四个相互隔离的求解通道，每通道保留两个有界任务槽

页面和 `/api/*` 由同一个 TanStack Start 服务提供，不需要单独启动 Express 或 Vite 服务。

## 本地运行

需要 Node.js 22 和 npm。

```bash
git clone https://github.com/KnightCodeSquareMatrix/RIIC-Web.git
cd RIIC-Web
npm install
npm run dev
```

开发服务默认监听 `http://127.0.0.1:5174`。

应用可以在没有数据库和邮件服务的情况下完成安装与构建。账号、邮件验证、云同步和森空岛能力需要额外配置，变量示例见 [`.env.example`](./.env.example)。

## 配置求解器

本仓库不分发 `infra-cli` 二进制。请从你有权访问的求解器项目构建与当前协议兼容的版本，并使用下面一种方式提供：

1. Linux 放到 `bin/infra-cli`，Windows 放到 `bin/infra-cli.exe`；
2. 通过 `INFRA_CLI_PATH` 指向本机可执行文件。

这两个路径已经加入 `.gitignore`，避免把私有或平台相关的构建制品提交到仓库。Linux 文件需要可执行权限：

```bash
chmod +x bin/infra-cli
```

服务器部署只使用应用根目录中由 root 管理的 `shared/bin/infra-cli`，并校验独立的 SHA-256 sidecar、GitHub Environment 批准摘要和 Worker 指纹。网站 release 不得携带 `bin/infra-cli`，共享制品缺失或校验不一致时部署会直接失败，因此发布网站不会替换或降级求解器。服务器上也不要从不可信来源下载或执行二进制。

如需单独指定求解器数据目录，可设置 `ARKNIGHTS_INFRA_DATA_DIR`。启动应用后访问 `/api/health`，成功信封中的 `data.plannerReady: true` 表示排班服务可用。

排班结果必须经过 [`apps/arknights/src/server/public-plan.ts`](./apps/arknights/src/server/public-plan.ts) 的白名单映射。不要把求解器的命令、路径、标准输出、标准错误或内部诊断对象直接返回给浏览器。

## 可选服务

复制示例配置后再替换占位值，不要提交真实配置：

```bash
cp .env.example .env.local
```

常用变量：

| 变量 | 用途 |
| --- | --- |
| `APP_DEPLOYMENT_ENV` | `development` 或 `production` |
| `SKLAND_FEATURE_ENABLED` | production 中只有精确值 `1` 才启用森空岛 |
| `SKLAND_SESSION_SECRET` | 森空岛会话加密密钥，至少 32 字节 |
| `BETA_PUBLIC_ORIGIN` | 公开写请求允许的完整 Origin |
| `SKLAND_PUBLIC_ORIGIN` | 森空岛会话流允许的完整 Origin |
| `DATABASE_URL` | 运行时 PostgreSQL 连接串 |
| `DATABASE_MIGRATION_URL` | 数据库迁移连接串 |
| `BETTER_AUTH_SECRET` | 网站 Session 签名密钥，至少 32 字节 |
| `BETTER_AUTH_URL` | 网站账号对外 Origin |
| `RESEND_API_KEY` | 邮件验证与密码重置 |
| `ACCOUNT_CLOUD_SYNC_ENABLED` | 是否开放账号云同步 |

生产环境应使用 HTTPS、长期稳定的随机密钥、最小权限数据库账号，并把配置放在部署平台的密钥管理中。

## 数据与隐私边界

- 森空岛支持官方二维码授权，以及由用户从已登录官网主动生成的凭证导入；本站不接收账号密码或短信验证码。
- 森空岛凭据使用 AES-256-GCM 封装在 HttpOnly Cookie 中，不写入 localStorage、运行记录或反馈。
- 排班 API 只公开白名单字段；调试字段在 production 强制关闭。
- 完整 Box 和求解器输出只作为私有诊断资料保存；只有已鉴权管理员能通过不缓存的管理接口读取经过白名单过滤的复现资料。
- 私有 CLI 运行资料与对应业务摘要滚动保留最多 30 天；旧格式制品只通过同一白名单兼容读取，不直接返回原始调试包。
- 运行记录、反馈、云工作区和分析数据各有独立的最小化与保留策略。
- 提交 Issue 时不要附带 MAA Box、Cookie、令牌、数据库连接串、真实用户信息或服务端日志。

公开的数据范围见 [森空岛数据能力矩阵](./docs/SKLAND_DATA_CAPABILITIES.md)，页面中的服务条款与隐私政策位于 [`apps/arknights/src/app/terms`](./apps/arknights/src/app/terms) 和 [`apps/arknights/src/app/privacy`](./apps/arknights/src/app/privacy)。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `apps/arknights/src/routes` | 明日方舟 TanStack Start 路由与 API 入口 |
| `apps/arknights/src/app` | 现有页面与 API handler 实现 |
| `apps/arknights/src/components` | 页面、布局和业务组件 |
| `apps/arknights/src/components/ui` | 通用 UI primitives |
| `apps/arknights/src/server` | API 契约、求解器客户端、认证与持久化边界 |
| `apps/arknights/src/layouts` | 基建布局预设 |
| `apps/endfield` | 终末地独立应用、路由、主题和静态资源 |
| `packages` | 共享外框、交互组件、字体、登录契约和游戏数据/求解逻辑 |
| `drizzle` | 数据库 schema 迁移 |
| `apps/arknights/messages` | use-intl 中英文界面消息、结构化展示记录与翻译维护说明 |
| `apps/arknights/public` | 方舟静态图片与第三方素材快照 |
| `scripts` | 构建、公开测试、资源同步和仓库卫生检查 |

求解器协议与公共 DTO 的说明见 [Frontend Serve Guide](./docs/FRONTEND_SERVE_GUIDE.md)。

两站开发命令、独立构建产物和发布目录说明见 [双应用工作区](./docs/WORKSPACES.md)。

## 文档索引

- 使用与数据：[键盘和移动端操作](./docs/keyboard-shortcuts.md)、[专精规划](./docs/MASTERY_PLANNER.md)、[预计日产物计算逻辑](./docs/计算逻辑.md)、[森空岛数据能力矩阵](./docs/SKLAND_DATA_CAPABILITIES.md)
- 求解器与协议：[Frontend Serve Guide](./docs/FRONTEND_SERVE_GUIDE.md)、[`final_efficiency` 接入口径](./docs/TRADE_PRODUCTION_CONTRACT_GAP.md)、[本地求解器目录](./bin/README.md)
- 部署与仓库管理：[PostgreSQL 部署模板](./deploy/postgres/README.md)、[systemd runtime settings](./deploy/SYSTEMD.md)、[公开仓库管理清单](./docs/REPOSITORY_ADMIN_CHECKLIST.md)
- 贡献与发布：[参与贡献](./CONTRIBUTING.md)、[网站翻译维护](./apps/arknights/messages/README.md)、[公开仓库迁移说明](./MIGRATION.md)、[Changelog](./CHANGELOG.md)、[Contributors](./CONTRIBUTORS.md)
- 安全与权利：[安全政策](./SECURITY.md)、[第三方素材来源](./THIRD_PARTY_ASSETS.md)、[许可证](./LICENSE.md)
- 代码代理说明：[AGENTS.md](./AGENTS.md)、[CLAUDE.md](./CLAUDE.md)

## 开发与检查

```bash
npm run check
npm run audit:security
npm run build
```

`npm run check` 会执行公开仓库卫生检查、生成资源与国际化校验、ESLint、单元测试、API 契约测试和排班对比测试；翻译目录也可单独运行 `npm run check:i18n`。浏览器测试可分别通过 `npm run test:e2e`、`npm run test:e2e:production-profile` 和 `npm run test:e2e:webkit` 运行。`npm run build` 会准备不含求解器的 `apps/arknights/.output` 运行目录，并补齐其中的 `public` 与 `public/assets`；生产启动脚本会使用这一目录。`npm run build:all` 构建两站。涉及数据库 schema 的改动，应先设置 `DATABASE_MIGRATION_URL`，再执行：

```bash
npm run db:generate
npm run db:migrate
```

所有普通功能、修复和人工资源 PR 都应提交到 `develop`；`main` 只接收维护者从同仓库 `release/**` 分支发起的发布 PR。仓库内置的 arkntools 受管资源同步是严格白名单化的例外：隔离生成和本地质量门禁通过后，它会从固定 release 分支创建带 `direct-main-release` 标签的审计 PR，自动合并、触发完整 main 发布，并将同一批资源对齐回 `develop`。其他特批直接发布仍必须由维护者设置该标签并通过其余全部质量门禁。完整流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。不要把本地环境文件、求解器二进制、运行记录、用户数据或浏览器自动化产物加入提交。

## 第三方素材

干员头像、基建技能图标、游戏名称和描述属于其各自权利人。本项目不主张对《明日方舟》素材的所有权，来源、固定版本和字体许可见 [THIRD_PARTY_ASSETS.md](./THIRD_PARTY_ASSETS.md)。

本项目是非官方社区工具，与上海鹰角网络科技有限公司、Hypergryph 或《明日方舟》官方没有隶属或背书关系。

## 许可证

本项目自有代码按 [PolyForm Noncommercial License 1.0.0](./LICENSE.md) 提供。你可以为非商业目的使用、研究、修改和分发代码；商业使用需要另行取得相关权利人的书面许可。

这是一份“源码可用、限制商业用途”的软件许可证，不是 OSI 认可的开源许可证。第三方依赖、字体和游戏素材继续适用各自的许可证或权利声明，不因本项目许可证而改变。
