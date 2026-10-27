# 认证邮件：阿里云主通道与手动回退

方舟、终末地与公共平台共用认证邮件发送层，默认通过阿里云 Direct Mail 的 `SingleSendMail` API 发送注册验证码和密码重置邮件。`AUTH_EMAIL_PROVIDER` 未设置、为空或仅含空白时均选择阿里云；不要求 Resend API key。阿里云配置不完整时明确失败，不会因为存在 Resend 密钥而静默改用 Resend。

阿里云主发失败时不会自动跨提供商重发。只有显式设置 `AUTH_EMAIL_PROVIDER=resend` 才会使用保留的 Resend 通道，供受控回退或测试使用。

**已有部署需要同步检查运行配置。** 如果服务器环境仍显式设置 `AUTH_EMAIL_PROVIDER=resend`，代码默认值更新不会覆盖它；开发、生产环境中实际承接 `/api/auth/*` 的平台服务及应用兼容入口都应设置为 `aliyun`。

## 开通和配置

1. 开通阿里云邮件推送，完成实名认证、发信域名 DNS 验证和发信地址配置，选择用于验证码的触发类发信地址。
2. 确认账户日/月额度、余额及信誉等级覆盖预期峰值；购买资源包不等于提升发信额度。
3. 为网站建立专用 RAM 身份，授权所需的 `dm:SingleSendMail` 操作；使用长期 AccessKey ID / Secret。本适配器不接收 SMTP 密码、Cloudflare token 或 STS 临时凭据。
4. 将以下值写入应用服务端运行环境，然后重启应用。不要写入公开仓库、前端变量或构建产物。当前 GitHub 发布工作流使用服务器既有运行环境；只添加 GitHub Secret 不会自动注入这些变量。

```dotenv
AUTH_EMAIL_PROVIDER=aliyun
AUTH_EMAIL_FROM=可露希尔基建终端 <auth@example.com>

AUTH_EMAIL_FALLBACK_PROVIDER=none
ALIYUN_DM_REGION_ID=cn-hangzhou
ALIYUN_DM_ACCOUNT_NAME=auth@notify.example.com
ALIYUN_DM_ACCESS_KEY_ID=<专用 RAM AccessKey ID>
ALIYUN_DM_ACCESS_KEY_SECRET=<专用 RAM AccessKey Secret>
```

支持的地域和固定 HTTPS 地址：

| 地域 | Region ID | API 主机 |
| --- | --- | --- |
| 杭州 | cn-hangzhou | dm.aliyuncs.com |
| 新加坡 | ap-southeast-1 | dm.ap-southeast-1.aliyuncs.com |
| 美国弗吉尼亚 | us-east-1 | dm.us-east-1.aliyuncs.com |
| 德国法兰克福 | eu-central-1 | dm.eu-central-1.aliyuncs.com |

地域必须与阿里云控制台创建发信地址的地域一致。`ALIYUN_DM_ACCOUNT_NAME` 填裸邮箱地址，不带显示名；可以与 Resend 发件地址不同。两个通道均使用“可露希尔基建终端”显示名及原有 HTML、纯文本内容；不启用点击跟踪、不使用回信地址。

阿里云作为主通道时，无论备用开关取何值，都必须提供完整有效的阿里云配置。`AUTH_EMAIL_FALLBACK_PROVIDER=none` 仅关闭备用机制，不关闭阿里云主发。

## 切换与回退

- 全站标准配置：`AUTH_EMAIL_PROVIDER=aliyun`、`AUTH_EMAIL_FALLBACK_PROVIDER=none`，提供有效阿里云配置。
- 手动回退到 Resend：显式设置 `AUTH_EMAIL_PROVIDER=resend`、`AUTH_EMAIL_FALLBACK_PROVIDER=none`，并提供有效的 `RESEND_API_KEY`。两环境的实际认证服务需要分别修改并按发布流程重启。
- 保留的旧主备模式：显式设置 `AUTH_EMAIL_PROVIDER=resend`、`AUTH_EMAIL_FALLBACK_PROVIDER=aliyun`，同时提供两套配置。仅当 Resend 明确返回 `monthly_quota_exceeded`、`daily_quota_exceeded` 或 `rate_limit_exceeded` 时，通过阿里云发送一次。

旧主备模式不查询月用量，也不在第 50,001 封主动分流。若 Resend 开启超额计费并继续受理请求，不会触发额度 fallback。网络异常、5xx、参数错误、账户停用及无法确认的响应均不跨提供商自动重发，避免重复投递或绕过收件人限制。

每次最多一次 Resend 请求、一次阿里云请求；阿里云请求及读取响应限时 10 秒、拒绝重定向、无内部自动重试。必须收到 HTTP 成功响应、非空 `EnvId` 且无 `Code` 才认定接口受理；这不代表已到达收件箱。失败会返回调用方，不会假报成功。

旧主备模式的自动切换日志为 `[auth-email] Resend <容量错误码>; using aliyun.`。阿里云直接主发不会产生这条回退日志。本站错误不输出请求正文、提供商响应正文、凭据、收件地址或验证码。提供商侧投递记录与退信仍需在阿里云控制台核对。

## 验证与启用

`npm run test:auth-email` 使用模拟网络，覆盖阿里云默认路由、显式 Resend 回退、阿里云官方签名样例、主备路由、两种认证邮件、拒绝与未知投递状态，不发送真实邮件。测试也纳入 `npm test`；仅验证邮件时可运行前者。

`npm run auth:check` 校验邮件配置并执行既有数据库 readiness 检查，不验证 AccessKey 权限、发信地址状态、发送额度或真实投递。发布前应在两环境分别验证阿里云配置已经具备，发布后核对实际进程采用的主通道；只报告通道和配置校验状态，不输出凭据。发布代码不会替你开通阿里云服务，也不会覆盖服务器显式配置。

实际启用前，用已授权的测试收件地址验证 QQ、163、Gmail 等主要收件服务上的注册验证码和密码重置流程，核对延迟、垃圾箱、显示名及链接。可以在隔离环境临时设置阿里云主发模式；不要通过耗尽生产额度或破坏 Resend 密钥进行演练。

此前本地 Cloudflare 备用方案已被此阿里云方案替代，旧 `AUTH_EMAIL_FALLBACK_URL/TOKEN/CUSTOM_AUTH` 不再使用，`cloudflare-temp-email` 不是有效 provider。

官方参考（2026-09-07 核对）：[SingleSendMail](https://help.aliyun.com/zh/direct-mail/singlesendmail)、[签名规则和测试样例](https://help.aliyun.com/en/direct-mail/signature)、[API 地域](https://help.aliyun.com/zh/direct-mail/api-endpoints)、[Resend 错误码](https://resend.com/docs/api-reference/errors)。
