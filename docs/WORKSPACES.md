# 双应用工作区

明日方舟和终末地是同一 npm workspace 中的两个独立 TanStack Start 应用，分别拥有路由树、Vite 配置、静态资源、类型检查缓存和构建产物。没有根目录 `src` 的兼容链接，也不采用一个构建入口包含两站的 MPA。

```text
apps/
  arknights/
    src/                 页面、路由、游戏业务与兼容 API 入口
    public/              方舟资源
    messages/            方舟翻译
    package.json
    tsconfig.json
    vite.config.ts
  endfield/
    src/                 终末地页面与受限账号代理
    public/              终末地资源
    tests/
    package.json
    tsconfig.json
    vite.config.ts
packages/
  shell/                 侧边栏、游戏切换、账号显示和备案组件
  ui-primitives/         通用交互组件、状态动画和 Bender 字体
  contracts/             最小账号视图、错误协议、游戏数据身份
  platform/              共享 HTTP 客户端、政策版本、二维码轮询
  platform-server/       认证、数据库、森空岛与云存档实现
  arknights-domain/      平台与方舟共同使用的纯逻辑、模型和数据
  endfield-ui/           终末地视觉组件
  endfield-data/         官方解包显示数据
  endfield-skland/       终末地数据契约
  endfield-solver/       算法适配与固定版本上游
services/
  platform-api/          可独立启动、构建与发布的公共 API 服务
scripts/                 工作区工具、Worker、资源同步、发布打包
drizzle/                 唯一一套数据库迁移
fixtures/                共用测试/求解样例
tsconfig.base.json       无应用路径别名的共同编译设置
tsconfig.json            根目录工具配置
```

## 开发和验证

在仓库根目录安装依赖，使用同一份 `package-lock.json`。不要在两个应用中分别生成锁文件。已有依赖目录若是目录联接，应先确认其归属，不能通过它清理另一个工作树。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` / `npm run dev:arknights` | 启动方舟，默认 5174 |
| `npm run dev -- --host 127.0.0.1 --port 5175 --strictPort` | 使用常用方舟预览端口 |
| `npm run dev:endfield` | 启动终末地，默认 5176 |
| `npm run dev:platform` | 启动公共平台，默认 5177 |
| `npm run dev:full` | 同时启动两站与平台；端口被占用时停止本次启动 |
| `npm run build:arknights` / `npm run build` | 构建方舟并准备运行包 |
| `npm run build:endfield` | 独立构建终末地 |
| `npm run build:all` | 依次构建两站与独立平台 |
| `npm run check:types` | 两站、平台和根工具类型检查 |
| `npm run test:workspace` | 目录、应用依赖边界和锁文件回归 |
| `npm run test:platform` | 请求隔离、缓存、共享会话和 HTTP 客户端回归 |
| `node scripts/test-platform-runtime.mjs` | 构建后验证平台进程、两站来源隔离，不连接数据库 |
| `npm run test:platform:integration` | 对显式指定的隔离测试数据库验证跨应用登录、续期和退出；须先构建平台并设置 `AUTH_INTEGRATION_DATABASE_URL` |
| `npm run test:endfield` | 终末地与共享账号的纯逻辑测试 |
| `npm run worker:build` | 根 `dist/` 下生成三个服务 Worker |
| `node scripts/test-workspace-release.mjs` | 构建后验证临时发布包启动与静态资源，不连接数据库 |

根命令转交给对应应用 workspace；也可以直接运行 `npm run dev --workspace @riic/arknights`。共同 Vite 启动器使进程工作目录保持仓库根目录，Vite 的应用 root 决定路由和资源路径。开发服务器按应用及端口隔离依赖缓存。

`check:types` 会先生成所属应用的路由类型，因此干净检出后可以直接运行，不需要预先启动开发服务器或保留本地生成文件。

方舟继续通过既有加载器读取根目录 `.env*`，不复制凭据。终末地的环境配置归属自身应用，参见 `apps/endfield/.env.example`；也可由进程环境注入。变更环境变量后需重启对应开发进程。

默认游戏跳转使用本地 5175/5176。使用其他端口时，为方舟设置 `VITE_ENDFIELD_ORIGIN`，为终末地设置 `VITE_ARKNIGHTS_ORIGIN` 和服务端的 `ENDFIELD_ACCOUNT_ORIGIN`。后者必须是固定的可信第一方账号服务地址，不从用户请求选择代理目标。

账号与数据库实现由 `@riic/platform-server` 承载。未配置 `PLATFORM_API_ORIGIN` 时，方舟保留进程内兼容入口；配置后，共享请求直接转到平台服务。终末地优先访问平台，旧的 `ENDFIELD_ACCOUNT_ORIGIN` 只用于分阶段升级兼容。UI 显示偏好与游戏草稿按站点独立保存；此次拆分不自动启用终末地云存档。

## 依赖和产物边界

应用可以依赖 `packages`；共享代码不能导入应用源码，一个应用不能导入另一个应用。纯配置和业务契约与游戏 UI 分开，避免通过复用一个按钮拉入另一站的路由、Provider 或样式。

源码使用 `@riic/<package>/<entry>` 与 `package.json` 的显式 `exports`。包内使用相对导入。工作区检查同时覆盖相对路径、旧别名、未声明依赖、无效导出和独立服务。React 由使用共享 UI 的应用提供；Tailwind 的 `@source` 继续覆盖共享组件，CSS 和字体有各自的导出入口。

方舟源码检查指向 `apps/arknights`，生产检查读取 `apps/arknights/.output`。根目录旧的 `.output` 不再作为源码工作区的启动/发布输入。`npm start` 在源码工作区选择新产物；在发布包中选择发布根目录的 `.output`。

`npm run release:stage -- --output <仓库外的新目录>` 仍生成原有服务器布局：

```text
release/
  package.json            最小运行清单，npm start 仍然可用
  scripts/start-standalone.mjs
  scripts/load-env.mjs
  .output/                方舟 Node 服务、静态资源、迁移与运维命令
  worker/                 三个自包含 Worker
  fixtures/
  .release-artifact.json
```

打包需要显式的 `RELEASE_SHA` 和 `RELEASE_TREE_SHA`，仍检查凭据、求解器和存储目录不得进入产物。数据库迁移与部署均不由本地构建触发。CI 保留既有测试及发布门禁。

终末地和平台分别通过 `npm run release:stage:app -- --app endfield --output <仓库外的新目录>` 与 `--app platform` 打包。每个产物包含自己的 `package.json`、`runtime/` 和来源清单，可从独立目录运行 `npm start`，分别部署和回滚。新增的 workspace workflow 构建并保存这两个独立产物，不触发生产发布。部署模板见 `deploy/endfield.service.example`、`deploy/platform-api.service.example` 和 `deploy/platform-proxy.nginx.conf.example`。

## 跨站会话与数据流

### 共用账号界面

`@riic/shell/SidebarAccountMenu` 是两站唯一的账号菜单实现，包含头像、语言切换、付费计划、更新日志、退出登录，以及底部帮助和设置按钮。应用只传入自己的路由链接、账号状态和操作回调。未登录时点击头像直接调用 `requestAccountSignIn`，不展开账号菜单。主题和账号管理统一从设置入口访问。

`@riic/shell/WebsiteAuthDialog` 复用原有登录表单，承载登录、注册、邮箱验证、找回密码和重置密码；公共表单与中英文文案位于 `packages/shell/auth/`。各应用监听 `ACCOUNT_SIGN_IN_EVENT` 并在当前页面打开弹窗。新增登录入口应使用 `requestAccountSignIn(event.currentTarget)`，不要添加登录页面或链接到 `/account`。旧 `/account` 和 `/account/reset-password` 地址仅兼容跳转到设置或首页上的弹窗，消费后从地址栏清除认证参数。

终末地通过同源的有限认证代理使用已有账号服务，只允许共享弹窗所需的认证操作；不会建立另一套账号数据库。付费计划保留在方舟头像二级菜单中，并遵循已有功能权限；终末地不提供付费入口。终末地 `/changelog` 使用本站的 `src/changelog.ts` 记录，预览改动标记为“开发预览”，不读取方舟更新日志。两站的游戏数据和显示偏好仍按各自已有规则保存。

生产平台配置 `PLATFORM_PUBLIC_ORIGINS` 为两个完整 HTTPS Origin，以逗号分隔。只有相关子域都受信任时才配置 `AUTH_COOKIE_DOMAIN`；它必须覆盖显式列出的两个 Origin，且 `BETTER_AUTH_URL` 属于列表。保留 HttpOnly、Secure 和 SameSite 策略。网站会话可以共享，森空岛授权仍使用现有按账号加密、绑定网站用户的 Cookie，不因网站会话共享而扩大授权范围。

应用配置 `PLATFORM_API_ORIGIN` 为固定平台地址，支持同机回环 HTTP 或 HTTPS。平台默认只监听 `127.0.0.1`；只有受控代理可访问它时，才启用 `BETA_TRUST_PROXY_HEADERS=1`。代理必须覆盖转发来源和客户端地址。不要对外开放可信代理模式的内部端口。共享 API 不包括方舟求解、管理员和计费入口；它们继续由相应应用负责。

公共后端用同一套数据库及迁移。账号删除仍包含游戏诊断与存档清理，因此独立平台必须与方舟任务进程共享既有私有存储配置；不要给新服务配置另一份空存储目录。

账号读取只在单次请求内去重，不跨用户缓存。SSR 的远端账号读取有 1.5 秒预算，失败后允许客户端重试。终末地快照缓存按网站用户、游戏、账号凭据指纹、服务器、角色和协议版本隔离，默认保留 30 秒、最多 100 条；并发相同读取合并，失败不缓存，断开账号清除对应用户缓存。`force: true` 可显式刷新，但仍受原有限流约束。该缓存属于单进程，扩容前需评估共享缓存和限流的部署方案。

每个共享接口返回 `private, no-store`；平台通过 `Server-Timing` 暴露请求耗时。比较冷启动、热缓存和实际森空岛同步的 p50/p95 时，分别记录公网、平台和上游耗时。`test-platform-runtime` 输出的本机读取样本仅验证本地路径，不代表生产性能。

## 依赖兼容边界

2026-10-23 升级覆盖根目录、两个应用、共享包和平台服务的 npm 依赖，保留 Node 22 运行环境。以下版本有明确的兼容约束：

- TypeScript 使用 6.0.3；当前 `typescript-eslint` 的 peer 范围为 `>=4.8.4 <6.1.0`，不能直接替换为 TypeScript 7。
- `@types/node` 使用 Node 22 的最新类型版本，避免引入运行时不支持的 API。
- `html2canvas-pro` 固定为 2.5.0；2.5.2 要求 Node 24。升级运行环境后再解除此限制。
- SheetJS 沿用官方分发的 0.20.3 CDN 包，不能换成 npm 上较旧的 `xlsx` 版本。
- Playwright 的 npm 版本与 CI 容器标签、镜像摘要一起更新，保持浏览器二进制匹配。

## 上线顺序与回滚

1. 发布兼容两种运行方式的代码，保留方舟旧入口。
2. 使用同一环境的数据库、认证密钥、森空岛密钥和私有存储启动独立平台，核对允许的 Origin。
3. 验证共享会话、续期、退出和账号切换，再将两站共享请求切到平台；方舟与终末地可以独立回滚。
4. 保留兼容入口直到旧客户端与旧部署退出。平台接口使用增加字段的兼容演进；删除或改名字段前先完成消费者迁移。

不将本地构建成功、GitHub 检查通过或服务存活当作生产账号验收。首次启用域 Cookie 时需验证旧的 host-only 会话与新会话的迁移及清理。
