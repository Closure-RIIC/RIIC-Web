# 双应用工作区

明日方舟和终末地是同一 npm workspace 中的两个独立 TanStack Start 应用，分别拥有路由树、Vite 配置、静态资源、类型检查缓存和构建产物。没有根目录 `src` 的兼容链接，也不采用一个构建入口包含两站的 MPA。

```text
apps/
  arknights/
    src/                 页面、路由、现有账号服务与 API
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
  platform/              政策版本、森空岛登录链接和二维码轮询
  endfield-ui/           终末地视觉组件
  endfield-data/         官方解包显示数据
  endfield-skland/       终末地数据契约
  endfield-solver/       算法适配与固定版本上游
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
| `npm run build:arknights` / `npm run build` | 构建方舟并准备运行包 |
| `npm run build:endfield` | 独立构建终末地 |
| `npm run build:all` | 依次构建两站 |
| `npm run check:types` | 两站和根工具类型检查 |
| `npm run test:workspace` | 目录、应用依赖边界和锁文件回归 |
| `npm run test:endfield` | 终末地与共享账号的纯逻辑测试 |
| `npm run worker:build` | 根 `dist/` 下生成三个服务 Worker |
| `node scripts/test-workspace-release.mjs` | 构建后验证临时发布包启动与静态资源，不连接数据库 |

根命令转交给对应应用 workspace；也可以直接运行 `npm run dev --workspace @riic/arknights`。共同 Vite 启动器使进程工作目录保持仓库根目录，Vite 的应用 root 决定路由和资源路径。开发服务器按应用及端口隔离依赖缓存。

`check:types` 会先生成所属应用的路由类型，因此干净检出后可以直接运行，不需要预先启动开发服务器或保留本地生成文件。

方舟继续通过既有加载器读取根目录 `.env*`，不复制凭据。终末地的环境配置归属自身应用，参见 `apps/endfield/.env.example`；也可由进程环境注入。变更环境变量后需重启对应开发进程。

默认游戏跳转使用本地 5175/5176。使用其他端口时，为方舟设置 `VITE_ENDFIELD_ORIGIN`，为终末地设置 `VITE_ARKNIGHTS_ORIGIN` 和服务端的 `ENDFIELD_ACCOUNT_ORIGIN`。后者必须是固定的可信第一方账号服务地址，不从用户请求选择代理目标。

账号与数据库继续由已有方舟服务端承载；终末地经受限代理访问。UI 显示偏好仍按站点独立保存。移动源码不修改 Cookie、存档键、数据库内容或线上配置。

## 依赖和产物边界

应用可以依赖 `packages`；共享代码不能导入应用源码，一个应用不能导入另一个应用。纯配置和业务契约与游戏 UI 分开，避免通过复用一个按钮拉入另一站的路由、Provider 或样式。

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

打包需要显式的 `RELEASE_SHA` 和 `RELEASE_TREE_SHA`，仍检查凭据、求解器和存储目录不得进入产物。数据库迁移与部署均不由本地构建触发。CI 保留既有测试及发布门禁，并增加双应用类型检查、终末地构建和 workspace 边界检查；目录迁移本身不启用终末地线上部署。
