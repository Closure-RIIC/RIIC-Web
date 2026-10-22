# 参与贡献

感谢你帮助改进可露希尔基建终端。本仓库公开产品代码、公共 API 契约、单元/API/数据库集成测试和基于 mock API 的浏览器测试；求解器、服务器部署 helper、真实部署测试与内部运维资料不在公开仓库中。

## 分支与 PR

1. 从最新的 `develop` 创建功能分支。
2. 将功能、修复、文档和人工资源变更 PR 的 base branch 设为 `develop`。唯一例外是仓库内置的 arkntools 受管资源同步：它在隔离生成、路径白名单、完整检查和构建全部通过后，从固定的 `release/automation/arkntools-assets` 分支创建带 `direct-main-release` 标签的审计 PR，自动合并到 `main` 并触发完整发布流程，随后用独立 PR 对齐 `develop`。
3. 不要向 `main` 直接提交普通 PR。`main` 只接受维护者从本仓库 `release/**` 分支发起的发布 PR；确需跳过 `develop` 的特批发布，必须由维护者添加 `direct-main-release` 标签。
4. 普通 PR 不运行远程质量检查；PR 合并到 `develop` 或 `main` 后，目标分支才并行执行质量检查、生成一次发布产物，并在全部检查通过后部署。通过 development 验收的变更再经 release PR 晋级 `main`。

来自 fork 的 PR 不会获得 Environment secrets，也不会触发部署。只有指向 `main` 的发布 PR 会运行只读、无依赖安装的分支来源检查。请不要为了验证部署而在 PR 中添加、打印或探测 secret。

## 网页更新日志

- 用户可从侧边栏进入 `/changelog`。页面和新版弹窗复用 `ReleaseNotes`，弹窗复用现有 Dialog、Button 和 ScrollArea；帮助页与日志页共用 `InfoPageLayout`。
- 管理员登录后进入 `/admin/changelog`，新建条目，填写三段数字版本号（如 `0.6.1`）、发布日期、标题及新增／优化／修复内容。中文必填，英文可选；缺省英文显示中文。先保存草稿，再预览页面或弹窗，确认对应功能已经上线后点击“发布”。未来日期只能保存草稿，不会自动定时发布。
- “弹窗通知”控制该版本是否主动提示；关闭时仍展示在日志页。编辑已发布条目先保存为独立草稿，重新发布后才更新前台。“撤回”立即从后续公开请求移除条目；已经打开的页面回到标签页或刷新时更新，不会回退显示代码中的旧内容。发布过的版本号不可修改，也不可删除，只能撤回；未发布草稿可以删除。
- 内容存储在 `app.release_note`，正式／开发／本地按服务端部署环境隔离。后台显示当前环境，不能通过请求切换环境。每个环境需要分别发布，develop 的日志不会自动成为 main 的日志。迁移 `0015_release_notes.sql` 一次性导入已有公开历史；`apps/arknights/src/releases/latest.ts` 和 `history.ts` 仅保留为初始化测试样例，不再手工更新。
- 公共 `GET /api/releases` 只返回当前环境的已发布快照；`?mode=announcement` 返回允许通知的最高版本。管理员通过 `GET/POST /api/admin/releases` 及 `PATCH /api/admin/releases/:id` 管理日志，写入需要同源管理员会话和修订号校验。API 故障时页面可重试，自动弹窗静默跳过。
- 此后台只发布说明，不会部署代码或修改网站版本号。仓库的 `CHANGELOG.md` 和发布版本仍随代码发布流程维护。资源同步、文案编辑、同版本重新部署不重复弹窗。
- 首次访问或版本升级后，在工作台就绪且无其他弹窗、未计算时显示一次。关闭（包括 Esc、遮罩）或查看日志后，按环境将版本保存在浏览器本地；不会修改 Box。跨标签页同步已读，回退版本不重弹；禁用存储时至少保证当前页面会话不重复。
- 更新已有版本的文案不会重新打扰用户。需要再次通知时，应新增正式版本条目。浏览器清除站点存储后会重新提示。

## Git 身份与贡献归属

GitHub 按每个 commit 的 author email 关联贡献者，而不是按谁合并了 PR 推断作者。提交前请把本仓库的 Git 身份设为 GitHub 账号中已验证的邮箱，或 GitHub 设置页提供的 `noreply` 邮箱：

```bash
git config user.name "YOUR_GITHUB_NAME"
git config user.email "YOUR_GITHUB_NOREPLY_EMAIL"
git config --get user.name
git config --get user.email
```

修改邮箱只影响后续 commit；历史 commit 应将当时使用的邮箱添加到同一个 GitHub 账号，由 GitHub 重建归属，不要为修正统计重写公开分支历史。维护者在整合他人改动时，如一个 commit 确实包含双方工作，应使用关联到对方 GitHub 账号的 `Co-authored-by: Name <email>` trailer。

## 本地验证

需要 Node.js 22 和 npm。提交前至少运行：

```bash
npm ci
npm run check
npm run audit:security
npm run build
```

修改网站界面文案或语言选择逻辑时，应同步维护 `apps/arknights/messages/zh.ts`、`apps/arknights/messages/en.ts` 及对应命名空间，并单独运行 `npm run check:i18n`；游戏内干员名、基建技能名和描述继续由独立游戏文本目录维护，具体边界见 [`apps/arknights/messages/README.md`](./apps/arknights/messages/README.md)。

两站分别输出到 `apps/arknights/.output` 和 `apps/endfield/.output`，开发与构建使用 Vite / TanStack Start；`npm run build:all` 构建两站。根目录命令和发布包约定见 [双应用工作区](./docs/WORKSPACES.md)。需要隔离另一份本地构建时，请使用独立工作树和独立 node_modules；不要共用或删除正在运行实例的产物。Node.js 最低版本为 22.12。

修改页面交互或浏览器行为时，再运行：

```bash
npm run test:e2e
npm run test:e2e:production-profile
npm run test:e2e:webkit
```

数据库集成测试需要本地 PostgreSQL 和测试专用连接串：

```bash
npm run test:auth-integration
```

不要使用生产数据库、真实账号、真实 Cookie 或线上服务完成公开测试。E2E 必须使用仓库内样例和 mock API。

## 提交边界

- 可以提交产品源代码、公共协议、数据库迁移、公开测试、样例和经审查的生成资源。
- 不得提交 `AGENTS.md`、内部文档、服务器 helper、helper/备份/真实部署测试、solver contract smoke、`infra-cli`、凭据、用户数据、运行日志或 `.ts.net` 主机名。
- 不得提交私钥、token、真实 `.env` 文件、Playwright 报告、trace、截图或其他测试产物。
- 第三方素材变更必须同步更新来源和权利声明。

`npm run check:public-repository` 会对这些边界、常见 secret、超大文件、浮动 GitHub Action 引用和 `pull_request_target` 做失败关闭检查。

## 许可与署名

提交代码即表示你有权提供该贡献，并同意该贡献按 [PolyForm Noncommercial License 1.0.0](./LICENSE.md) 与仓库其余自有代码一同发布。第三方代码和素材仍适用各自的许可证或权利声明。

公开根提交不会携带旧仓库历史或历史邮箱。项目在 [CONTRIBUTORS.md](./CONTRIBUTORS.md) 中保留贡献者署名；如需更正显示名称，请提交 PR。

## 安全问题

请不要为漏洞创建公开 Issue。按照 [SECURITY.md](./SECURITY.md) 使用 GitHub 私密漏洞报告。
