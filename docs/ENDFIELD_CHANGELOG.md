# 终末地更新日志管理

终末地管理员登录后，从侧边栏「更新日志管理」或公开日志页进入 `/admin/changelog`。此入口使用现有网站账号和管理员权限；普通账号只能阅读 `/changelog`。

## 填写与发布

1. 新建日志，填写三段数字版本号、北京时间发布日期、标题及新增／优化／修复条目。
2. 简体中文必填，台湾繁体和英文选填；未填写的译文回退至简体中文。预览使用当前编辑语言。
3. 保存草稿，再点击发布。保存草稿不会改变已发布内容；公开页面只读取发布快照。
4. 已发布的版本号不能更改。撤回会隐藏公开日志并保留草稿，只有从未发布的草稿允许删除。日期未到的日志不能提前发布。

切换日志或离开页面时会提示未保存的内容。并发编辑返回冲突并保留输入，需要刷新列表、核对后重新选择最新记录。

最初的开发预览记录仍作为静态历史展示；此后的更新可从后台维护，无需修改代码。终末地当前只在日志页面展示更新，不自动弹窗。

## 数据与部署

`app.release_note` 通过 `application + environment + version` 唯一索引隔离日志。原有方舟入口固定使用 `arknights`，终末地入口固定使用 `endfield`。客户端不能提交站点或环境来改变查询范围；缓存和修订号检查也包含站点范围。

新增迁移为 `drizzle/0028_endfield_release_notes.sql`，由 Drizzle 生成。既有记录的 `application` 默认为 `arknights`，草稿和公开快照保持原样。

经授权发布时：

1. 先对相应环境执行既有迁移流程。
2. 更新方舟兼容宿主；若使用独立平台服务，同时更新平台服务。
3. 更新终末地应用。其 `PLATFORM_API_ORIGIN`（优先）或 `ENDFIELD_ACCOUNT_ORIGIN` 必须指向**同一部署环境**的服务；日志环境以该服务的 `APP_DEPLOYMENT_ENV` 为准。
4. 验证管理员草稿／发布／撤回和匿名读取，并确认方舟日志列表不包含终末地记录。

旧版方舟服务不具备站点过滤，因此启用终末地写入前必须先更新方舟服务。已有终末地记录后，不应单独回滚至无站点过滤的旧版方舟代码。

## 相关验证

- `npm run check:types`、`npm run check:i18n`、`npm run test:workspace`。
- `node --experimental-strip-types --import ./scripts/register-hooks.mjs --test apps/endfield/tests/release-proxy.test.mjs packages/platform-server/src/proxy.test.ts`。
- `node --experimental-strip-types --experimental-test-module-mocks --test apps/arknights/src/server/public-data-api.test.ts apps/arknights/src/server/public-data-cache.test.ts`。
- 为迁移后的隔离测试数据库设置 `AUTH_INTEGRATION_DATABASE_URL`，执行 `node --experimental-strip-types --import ./scripts/register-hooks.mjs --test apps/arknights/src/server/release-notes.integration.test.mjs`，覆盖两站同版本、越权 ID、草稿隔离、发布快照、并发冲突和管理员权限。
- 两站和平台构建完成后，可在同一隔离本地数据库运行 `node scripts/test-endfield-changelog-e2e.mjs`。脚本启动自己的本地服务、使用临时账号完成真实登录与编辑发布，并清理自建记录；不访问线上数据库。
