# 支付链路与对账

> 文档角色：current-reference
> 生命周期状态：current
> 领域键：billing.payment
> 当前真源：self（当前实现）；爱发电开发者手册（外部协议）
> 摘要：从付款未到账症状定位建单、付款验证、履约、恢复和人工处理，明确各阶段写入与保证边界
> 代码范围：apps/arknights/src/server/billing/；apps/arknights/src/app/api/billing/；packages/platform-server/src/db/schema.ts；scripts/agent-worker.mts
> 代码锚点：apps/arknights/src/server/billing/service.ts::createBillingOrder / fulfillBillingOrder；apps/arknights/src/server/billing/payments.ts::processAfdianPayment；apps/arknights/src/server/billing/reconciliation.ts::reconcileAfdianPayments；apps/arknights/src/server/billing/admin.ts::adjustBilling / resolveBillingReview
> 关联链路：[Agent 计费入口](agent-billing-prototype.md)、[开放策略](FEATURE_ROLLOUT.md)、[发布流程](PR_RELEASE_GUIDE.md)
> 核验基线：develop 9b21c8f + 本次支付恢复变更（2026-11-06）；代码变化时复核本页状态流和验证覆盖

## 1. 触发、入口与信任边界

本站支付入口为 `/billing`，需网站账号及 billing 功能权限。`POST /api/billing` 创建本地订单；爱发电通过 `POST /api/billing/webhooks/afdian` 通知交易号；现有 Agent worker 主动扫描上游订单；管理员在 `/admin/billing` 处理异常。前端显示或 Webhook 确认接收，都不能单独证明积分已到账。

[爱发电官方手册](https://guide.afdian.com/creator/developer) 规定查询请求的 MD5 签名、`query-order`、`data.order` 通知和 `ec=200` 确认响应。[afdian.ts](../apps/arknights/src/server/billing/afdian.ts) 对序列化后的 params、ts、user_id 按官方算法签名，默认请求 `https://afdian.com/api/open/query-order`。本站不信任通知提供的关联号、状态和金额：通知只用于提取交易号，再通过持有 API Token 的主动查询核验。API 请求签名不是 Webhook 自带签名。

官方回调没有本站自定义密钥头。直接接入时 `AFDIAN_WEBHOOK_SECRET` 留空；只有受控代理注入 `x-afdian-prototype-secret` 时才启用该项。回调验证探针不发积分、不创建付款。

## 2. 类型、身份与状态 owner

| 记录 | owner / 主键 | 保存什么 | 不能证明什么 |
|---|---|---|---|
| billing_order | [schema](../packages/platform-server/src/db/schema.ts)、service；本地 id、唯一 custom_order_id | 网站 user_id、建单价格和积分、原支付链接、pending/paid 状态 | pending 不代表没有发生上游付款 |
| billing_payment | schema、payments；唯一 provider + provider_order_id | 经 API 核验的交易、关联号、金额（分）、上游状态、证据、pending/review/fulfilled/closed | review 不代表已识别网站用户；fulfilled 也可来自管理员补账 |
| billing_ledger / wallet | service、admin；账本幂等键及用户钱包 | 实际积分变动、余额、交易依据 | 不是爱发电现金退款凭证 |
| billing_review | payments、admin；payment:付款 id | 待处理原因、核验依据、处理方式与操作者 | resolved 本身不等于补过积分 |
| billing_reconciliation | reconciliation；provider | next_page、next_run_at | 游标不是上游稳定快照 |

`custom_order_id` 用于网站订单关联；`out_trade_no` 用于上游付款去重，两者不可替代。金额使用 Decimal 转换成整数分，不通过四舍五入把异常金额变成有效付款。

## 3. 主链阶段与写入顺序

1. [billing API](../apps/arknights/src/app/api/billing/route.ts) 校验会话、来源和商品，交给 `createBillingOrder`。service 持久化用户、价格、积分快照及带 `custom_order_id` 的商品链接，再返回前端；未配置商品链接时拒绝建单。
2. [BillingPrototype](../apps/arknights/src/components/billing/BillingPrototype.tsx) 打开该链接，每笔待支付订单保留“恢复支付”原链接；存在待支付订单时每 5 秒刷新完整账单，避免最新待支付订单遮蔽旧单到账。弹窗被拦截后仍可使用原链接。
3. [Webhook](../apps/arknights/src/app/api/billing/webhooks/afdian/route.ts) 主动查询准确交易号。API 未验证成功就返回失败；验证后交给 `processAfdianPayment`。
4. payments 事务插入并锁定唯一付款，保存证据。已 fulfilled/closed 不重开；已存非空关联号或金额与新证据冲突时保留原依据并进入对账。已有带准确交易号的正向账本或 paid 本地订单视为已处理。
5. 成功付款具备关联号、精确金额并满足恢复时间边界后，调用 `fulfillBillingOrder`。其事务先锁付款、再锁订单和钱包，核对渠道、交易绑定、金额及订单状态；钱包、唯一账本、订单 paid、付款 fulfilled、开放对账关闭一起提交。积分来自建单时的 order.points。
6. 无关联、金额异常、订单不存在或绑定冲突则保留付款并创建唯一对账。只有持久化成功后才确认接收；`ec=200` 只表示本站接收了已验证交易。瞬时数据库错误向上失败，重试仍消费同一付款。

## 4. 分支、恢复与错误

| 症状 / 条件 | 当前行为 | 下一步 |
|---|---|---|
| 上游付了，但没有 custom_order_id | 付款 review，原因 missing_reference，钱包不变 | 核实付款人与处理依据，不能按金额/时间认领 |
| 回调未到或本站瞬时失败 | worker 查询页复用同一 processor | 查看 worker 是否运行、API 配置和游标到期 |
| 交易重复回调 / 多 worker | 唯一付款、唯一订单交易索引和事务锁去重 | 已处理付款不重复发积分 |
| 相同本地订单再次被另一交易支付 | 另一付款进入 local_order_conflict | 核实重复付款及退款处理 |
| 历史订单 / 已退款旧批次 | 对账默认不自动补入；关闭后不重开 | 记录退款依据，不调用模拟到账补积分 |
| 回调字段伪造 | 只采用主动查询的真实字段 | API 不成功时不给接收成功响应 |

已真实复现的外部路径是：从带关联号商品页点击创作者名称进入主页，再选择商品结算，关联号丢失。直接在原商品页付款保留关联号。此证据证明一种丢失路径，不证明所有历史漏单都走过它；本站无法替上游页面保存导航参数。需要换商品时应返回本站建单。

[reconciliation.ts](../apps/arknights/src/server/billing/reconciliation.ts) 每 5 分钟处理一页，session advisory lock 覆盖网络与处理，多个 worker 共用持久化游标。请求前写重试延迟，失败保持同页，末页回到第一页。按创建时间倒序的上游分页可能因新单插入重复或延迟扫描；这里依靠付款去重和循环扫描，不声明快照一致。网关维护失败不阻断独立支付扫描。

## 5. 人工处理与副作用

在“对账”按交易号或关联号搜索，查看详情中的金额、上游买家 ID 和异常原因。缺少关联时需要独立核实网站用户及是否已退款、已补偿；昵称、临近同金额订单都不是认领依据。

- 已退款或无需积分调整：现有“处理对账”记录核验依据并关闭付款。只记录处理，不执行现金退款、不改变钱包。
- 确认需要补入永久积分：在目标用户的钱包“调账”选补入，填写准确爱发电交易号、积分和依据。后端只接受上游状态成功且仍 review 的付款；同一事务写正向账本、钱包、付款 fulfilled 和对账 resolved。同一操作键重试返回原结果，不同键重复补同一付款被拒绝。补入交易号会存入 ledger metadata 与 afdian_order reference，通知重放不再自动补入。
- 未填写交易号的一般调账仍为原有管理功能，不自动认领爱发电付款。爱发电补账不能通过一般调账加模拟支付组合完成。

人工永久积分补入不等于本地商品订单自动变成 paid，也不实现月卡权益恢复；此类权益需要另外核实处理。

## 6. 上线配置与迁移

应用当前迁移链，包含 [0029](../drizzle/0029_afdian_payment_recovery.sql)。已有重复渠道交易号会让唯一索引迁移失败，应核对订单和账本，不删除记录或绕开约束。服务端和 worker 均需继承正确的 `AFDIAN_API_TOKEN`、`AFDIAN_USER_ID` 与商品链接配置；密钥不能进入文档、日志或前端。有历史退款/补偿数据的环境，上线前必须配置有效恢复时间并确认旧批次在范围外；留空不保护旧 Webhook 重放，不能以“扫描默认不发分”代替这项检查。

`AFDIAN_RECONCILE_FULFILL_AFTER` 是显式恢复上线时间（ISO 8601，含时区）。留空时主动扫描只记录/对账历史付款，不发积分，正常 Webhook 仍实时履约。配置后自动恢复仅覆盖该时间及以后创建的本地订单，且相同时间保护旧 Webhook 重放。启用前确认已退款、已补偿历史订单在范围外；付款日期不是这个判断字段。

回滚旧代码前停用支付扫描 worker；新增表可保留，但旧代码仍可能丢下无关联付款。代码推送和 PR 不等于迁移、生产部署或恢复开关已经启用。

## 7. 验证与保证范围

| 验证入口 | 证明的范围 |
|---|---|
| npm run test:feature-access | 回调只采用查询验证字段，伪造字段及探针不能发积分 |
| AUTH_INTEGRATION_DATABASE_URL=隔离的_test数据库 npm run test:billing-integration | PostgreSQL 付款并发去重、无关联留存、金额异常、历史边界、关闭重放、人工补入幂等及分页失败恢复 |
| npx playwright test e2e/billing-page.spec.ts --project=chromium --workers=1 | 原链接恢复、多订单刷新、弹窗拦截及原有账单行为（mock API） |
| npm run check；npm run check:types；npm run worker:build；npm run build:ci:arknights | 仓库约束、类型、worker 与应用构建 |

数据库测试须使用独立 `_test` 数据库，不能指向生产。浏览器 mock 测试不证明真实平台付款成功；真实付款复现不证明所有历史订单原因。现金退款、已入账积分冲正与商品 kind/duration 完整历史快照不在本次修复范围；当前 points 使用订单快照，商品类型与月卡时长仍来自配置。
