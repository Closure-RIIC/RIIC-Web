# 日产量、房间效率与无人机的前端边界

本文说明 RIIC-Web 当前对求解器、手动 WASM 评估器和前端产量模块的职责划分。具体公式、基础产量和特殊目标常量见 [计算逻辑](./计算逻辑.md)。

## 结果路径

| 路径 | 房间效率来源 | 自然产量来源 | 无人机产量来源 |
| --- | --- | --- | --- |
| 自动求解器结果 | 求解器 rotation | 有效的 `rotation.daily.production` | 前端 |
| 手动“根据排班计算” | WASM 完整房间结算 | 前端兼容 estimate | 前端 |
| 手动“根据效率计算” | 用户手填纸面技能效率 + WASM 跨设施效率 | 前端兼容 estimate | 前端 |
| 旧结果或不完整结果 | 已有 rotation 房间字段 | 前端兼容 estimate 回退 | 前端（存在有效目标时） |

`rotation.daily.production` 表示自然产量；`rotation.daily.drone_production` 表示无人机带来的额外产量。两者在展示层组合，不能把无人机结果当作自然产量字段写入。

## 求解器自然产量字段

求解器自然日产量使用完整组：

```ts
rotation.daily.production = {
  lmd,
  pure_gold,
  battle_records,
  originium_shards,
  orundum,
  equivalent_gold?,
};
```

| 字段 | 含义 | 计算者 |
| --- | --- | --- |
| `lmd` | 贸易站自然龙门币日产量 | 求解器 |
| `pure_gold` | 赤金自然日产**价值**，不是赤金枚数 | 求解器 / 前端手动 estimate |
| `battle_records` | 自然经验产量 | 求解器 / 前端手动 estimate |
| `originium_shards` | 自然源石碎片产量 | 求解器 / 前端手动 estimate |
| `orundum` | 自然合成玉产量 | 求解器 / 前端手动 estimate |
| `equivalent_gold` | 特殊贸易机制产生的前端等效赤金价值 | 前端 |

自动求解器结果只有在自然产量必需字段完整、有限且非负时才作为自然产量来源。前端不会混用半套求解器字段与半套 estimate 字段；不完整时整体回退到前端兼容 estimate。

`pure_gold`、`equivalent_gold` 和无人机 `pure_gold` 都处于赤金价值域。仅在展示赤金“枚”时才换算为枚数。

## WASM 房间效率字段

WASM 是手动排班的房间效率结算器，不是当前手动日产量的权威来源。它返回 basis points；前端统一除以 `1000` 后写入手动结果状态。

| WASM 字段 | 前端字段 | 含义 |
| --- | --- | --- |
| `display_base_basis_points` | `baseEfficiency` → `base_efficiency` | 展示基础项。贸易/制造包含固有 100% 与岗位基础；发电站为 0。 |
| `display_skill_basis_points` | `skillEfficiency` → `equivalent_efficiency` | WASM 技能项；发电站为单站效率增量。 |
| `display_global_basis_points` | `globalEfficiency` → `global_efficiency` | 跨设施/全局项。 |
| `display_total_basis_points` | `totalEfficiency` → `total_efficiency` | 订单倍率前的房间总效率。 |
| `order_multiplier_basis_points` | `orderMultiplier` → `order_multiplier` | 贸易订单/特殊组合倍率；非贸易房间为 1。 |
| `display_final_basis_points` | `finalEfficiency` → `final_efficiency` | 订单倍率后的最终房间效率。 |
| `trade_equivalent_basis_points` | `tradeEquivalentEfficiency` → `trade_equivalent_efficiency` | 贸易展示/等效指标，不是自然产量直接输入。 |
| `gold_equivalent_basis_points` | `goldEquivalentEfficiency` → `gold_equivalent_efficiency` | 前端计算等效赤金价值使用的指标，不是赤金枚数。 |

WASM response 可以携带逐房/聚合的 per-day output 信息，但 RIIC-Web 当前手动产量流程不消费这些字段；手动路径使用上述映射后的房间效率，再由前端完成产量计算。

对于手动“根据效率计算”，WASM 只提供 `display_global_basis_points`。用户填写的纸面技能效率仍是技能项，前端以基础项、纸面技能项和 WASM 跨设施项构成房间效率。

## 前端产量职责

### 自然产量兼容 estimate

前端自然 estimate 使用以下数据：

- 布局中的房间类型、等级；
- MAA/手动计划中的配方或订单；
- 每班时长与完整周期归一化；
- `total_efficiency`、`order_multiplier`、`final_efficiency`；
- 前端维护的基础日产量与合成玉链瓶颈规则。

优先使用 `total_efficiency × order_multiplier`；旧数据缺少这两个字段时才回退 `final_efficiency`。前端不从房间展示字段反推干员技能或重复应用贸易订单机制。

`estimateDailyProduction()` 只负责自然产量和合成玉链明细；它不结算用户选定的无人机目标。

### 无人机产量

无人机由前端生成：

```ts
rotation.daily.drone_production = {
  lmd,
  pure_gold,
  battle_records,
};
```

| 输入 | 用途 |
| --- | --- |
| 发电站 `equivalent_efficiency` | 单站效率增量。 |
| 发电站是否在岗 | 决定在岗加成。 |
| 班次时长 | 计算该班无人机数量与等效产能。 |
| 实际班次目标房 | 决定无人机加速产物。 |
| 目标房人员、等级、配方/订单 | 识别普通贸易站、但书、龙舌兰、可露希尔、赤金制造或经验制造规则。 |

自动方案由服务端先枚举/选择目标；手动方案尊重用户选择的目标。两条路径共用前端 target-output 规则并按完整轮换时长日化。

无人机目标产出**不**套用通用的“目标房 `final_efficiency`”乘法。普通贸易站、特殊贸易站、赤金制造站和经验制造站各自使用对应的前端目标产出口径。当前无人机 DTO 不含源石碎片或合成玉字段；这两类无人机目标不会由该 DTO 表示。

## 展示层

展示层组合而不重算业务产量：

- 经验：自然经验 + 无人机经验；
- 龙门币：自然订单 + 无人机订单；
- 赤金：自然赤金价值、无人机赤金价值、等效赤金价值与界面规定的日常获取值先在价值域组合，再换算为赤金枚数；
- 合成玉与源石碎片：优先使用求解器自然产量；兼容 estimate 可提供制造/订单阶段与瓶颈明细。

具体公式、基础产量、特殊贸易目标和日化过程以 [计算逻辑](./计算逻辑.md) 与当前实现为准。本文件仅定义字段含义和计算职责边界。
