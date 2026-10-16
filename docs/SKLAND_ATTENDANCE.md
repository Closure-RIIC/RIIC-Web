# 森空岛明日方舟签到

状态中心显示当前森空岛账号、当前角色的今日签到状态和奖励，支持手动签到。自动签到默认关闭，用户可按账号/角色开启“打开本页时自动签到”；选择保存在当前浏览器，不保存凭据。关闭页面后不执行后台任务，也不保证页面一直打开时跨零点自动执行。

实现复用现有 `skland-kit` 的 `getAttendanceStatus({ uid, gameId: 1 })` 与 `attendance`。参考项目：[AEtherside/skland-daily-attendance](https://github.com/AEtherside/skland-daily-attendance)，未引入其任务调度服务。

`GET /api/skland/attendance?accountId=...&uid=...` 查询状态；同路径 POST 执行签到，请求体为空。两个入口均通过网站登录、森空岛能力及账号归属检查；POST 增加同源检查、大小限制与限流。适配器重新核对上游绑定关系，不接受任意 UID。

日期按上游 currentTs 的北京时间计算。先查状态再签到，同进程并发写请求合并；上游写失败时再次查询今日记录，只有确认已签到才按成功处理。未把任意错误码直接当作“已签到”。跨进程/跨设备仍由上游状态与幂等约束兜底。

复用现有加密、绑定网站账号的森空岛 Cookie。刷新签名 token 不延长原有七天授权。接口仅返回 UID、签到日期、状态和奖励名称/数量，不返回凭据。授权失效时重新扫码。

新增模块：`src/skland-attendance.ts`、`src/components/skland/SklandAttendance.tsx`、API route 和 TanStack adapter。新文案同时维护 `SklandAttendance` 中英文命名空间。

验证入口：`npm run test:skland-attendance`、`npm run check:i18n`，以及 `e2e/skland-attendance.spec.ts`。单元/接口/浏览器测试使用模拟凭据及上游响应，不能视为真实账号领取验证。真实联调需用户自行授权并点击签到。
