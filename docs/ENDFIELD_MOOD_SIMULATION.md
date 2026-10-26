# 帝江号心情模拟（模拟回放）原理

本文描述 `apps/endfield` 当前实现的心情/产出模拟，并与早期的独立步进模拟页
（`F:\DiJiang\endfield-simulated`，下称“旧页”）对照，说明数据来源、事件模型、
曲线口径和常见异常。

## 1. 页面形态与入口

| | 旧页 | 当前实现 |
| --- | --- | --- |
| 入口 | 独立 `/manual/step/` 静态页 | `/manual` 的“模拟回放”标签；`/step` 仅做 307 重定向到 `/manual?view=simulation` |
| 人员来源 | 手动排班页写入的 `sessionStorage` | 直接读取 `Workspace.manual`（手动排班页的同一份状态） |
| 干员/技能 | `Agent_characteristics.json` 的天赋数组 | `@riic/endfield-solver` 的 `catalog` / `operatorEffects`（固定版本解包数据） |
| 产物 | 手动排班页写入的 `DijiangManualProduct` | `Workspace.options.mfg`（制造布局）与 `options.grow`（培养槽） |
| 换班时刻 | 页面自己的 `DijiangStepRoomConfigs` | `Workspace.manual[].hour`（1–23 整点） |
| 配置存储 | 4 个 `sessionStorage` 键 | `localStorage` 键 `riic:endfield:step:v1`，v2 结构 |
| 访问控制 | 无 | 站点管理员门禁（见第 8 节） |

当前页面不是一个独立路由树，而是 `ManualPage` 在 `view=simulation` 时懒加载
`MoodSimulationPanel`，把编辑中的排班直接作为模拟输入；排班变化会以
`workspaceKey(workspace)` 作为 key 重新挂载面板，清除旧回放。

## 2. 数据流

```
Workspace（operators / options / manual）
        │  manualTemplate(options) 决定舱室与工位数
        ▼
buildStepConfig(..., "manual")
  → StepConfig { rooms[{key,slots,hour,single:false,products,crewA,crewB}],
                 moods, work, boost }
        │
        │  effectTable(workspace) —— 每个干员一份 operatorEffects()
        ▼
roomEffectResolver(table) —— 把求解器 0–1 小数换算成百分点
        │
        ▼
StepSimulation(config, resolver, SIM_RATES, {startHour,maxHours,sampleSec})
        │  snapshot()/advanceBy()/seekTo()/runToEnd()
        ▼
StepView { tSec, maxTSec, ops[], rooms{}, output{}, workTimeSec{}, history[], log[] }
        │
        ├─ useMoodSimulation：当前快照 + 完整时间线
        └─ MoodCharts / StepPanels / OperatorStates / StepSettings
```

关键点：

- 模拟的人员与换班只来自 `Workspace.manual`，不再有“从当前结果导入”。自动排班结果
  需要先通过手动排班页的“使用当前双班结果”写入 manual，才能进入模拟。
- `roomsFromManual` 对每个存在的手动舱室一律 `single: false`，即 A 班
  `[00:00, hour)`、B 班 `[hour, 24:00)`。B 班为空时换班后无人，舱室按规则停工到下一次
  换班，不会自动改成单班。
- 未在 `Workspace.operators` 名单里的名字会在 `fitCrew` 中丢弃，避免旧草稿越权。

## 3. 效果数据的单位（最容易出错的地方）

求解器的技能数值是 **0–1 的小数**：

```json
{ "kind": "加成", "cat": "干员经验", "value": 0.30 }
{ "kind": "减免", "value": 0.15 }
{ "kind": "恢复", "value": 0.12 }
```

引擎公式使用 **百分点**：

- 工作消耗：`7.2 × (1 - reduce / 100)` %/h
- 休息恢复：`12 × (1 + restore / 100)` %/h
- 单类产率：`(1 + efficiency / 100) × (1 + 0.4 × 工作人数)`
- 助力：每次 `+30` 点心情

因此 `roomEffectResolver` 在聚合时必须乘 100：

```ts
effects.reduce   += effect.value * 100;
effects.restore  += effect.value * 100;
effects.effMap[cat] += effect.value * 100;
```

如果漏掉这一步，所有技能效果都会缩小 100 倍，表现为：

- 有 15% 心情消耗减少的干员，实际只减少 0.15%，几乎和没有技能一样；
- 中枢 40% 恢复加成只按 0.4% 计算；
- 制造/培养/会客效率只按 0.3% 计算，产率几乎只剩“人数加成”。

诊断方法：`operatorEffects` 返回 `0.12`，`roomEffectResolver(...).restore` 必须是
`12`，而不是 `0.12`。

## 4. 事件驱动内核

### 4.1 状态

- `tSec`：相对模拟起点的秒数，精度 1 秒。
- `ops[]`：每个已排班干员一条记录：
  `{ name, roomKey, round("round1"|"round2"), mood(0–100), working, wantWork, reduce, restore, effMap }`
- `rooms{}`：`{ activeRound, shiftEnabled, shiftABSec, shiftBASec, nextSwitchAtSec }`
- `output{}`：会客室/制造舱为数字（等效小时累计），培养舱为 `{产物: 数字}`。
- `workTimeSec{}`：各舱室“有人在岗且在工作”的累计秒数。
- `history[]`：按采样间隔记录的心情、工作状态、产率、当前轮次。
- `log[]`：开始/换班/助力/心情归零/回满/结束/暂停。

### 4.2 速率与时间轴

- 工作：`7.2%/h`（`0.072 × 100 / 3600` 点/秒）
- 休息：`12%/h`（`0.12 × 100 / 3600` 点/秒）
- 中枢恢复：休息中的干员使用 `12 × (1 + centralBonus / 100)`；`centralBonus` 为
  当前中枢 A/B 班在岗干员 `restore` 之和（百分点）。
- 换班按自然日锚定：A `[0, hour)`、B `[hour, 24)`。
  - 起点在 A：下一次换班在 `hour`；
  - 起点在 B：下一次换班在 **24:00**（不是第二天的 `hour`），这是旧页最容易写错的一点。

### 4.3 事件选择

`findNextEventSec()` 取以下最小值：

1. 下一次采样时间；
2. 下一次未触发的助力时间；
3. 每个舱室的 `nextSwitchAtSec`；
4. 每个干员“工作到 0”或“休息到 100”的时间。

`nextEvent()` 推进到该时刻 → `advanceTo()` 按分段匀速更新心情与产出 → `processEventsAt()`
处理助力、归零/回满、换班、采样。

换班点只表示“上班/休息”的切换提示。某班组心情提前耗尽时，不会立即把另一班拉起来；
该班组在原地按当前恢复速度休息，若该舱室所有干员都在休息则整舱停工，若在班组时间内
回满则重新工作。心情跨天继续沿用，不回满、不重置。

### 4.4 时间推进 API

- `snapshot()`：返回深拷贝的 `StepView`，供 React 渲染，避免引擎继续推进时读到半更新状态。
- `advanceBy(seconds)`：按真实经过时间 × 播放倍率推进；采样精度不改变播放速度。
- `seekTo(seconds)`：向前跳转直接 `advanceBy`；向后跳转调用 `build()` 从初始状态重放，
  保证助力触发次数与换班不被插值破坏。
- `runToEnd()`：一次跑完，用于完整曲线和“展示模拟结果”。

### 4.5 缓冲上限

- `MAX_SAMPLES = 40000`：超过后 `history.shift()` 丢弃最早采样；
- `MAX_LOG = 2000`：日志同样丢弃最早条目；
- 同一时刻只保留最后一个采样，避免换班/归零事件与采样重合时出现同 x 的假折线；
- 图表侧再压缩到约 720 个点（见 5.2），完整历史仍用于统计与日志。

96h / 10s 采样的基准样本约 34,560 条，通常不会触发丢弃；如果叠加大量换班/助力/心情
事件，可能接近上限。极端情况下曲线起点会前移，这是当前已知限制。

### 4.6 点击后生成结果

`useMoodSimulation` 在页面就绪时只创建一个停在 0 时刻的引擎，**不计算完整曲线**。用户点击
“展示模拟结果”后才执行 `runToEnd()`，缓存完整时间线并把视图定位到结束时刻；因此首次访问
页面不会产生模拟结果，也不会卡在长时间计算上。

顶部只保留两个操作按钮：

- **展示模拟结果**：运行完整模拟、展开“事件日志与模拟统计”，滚动到曲线；
- **重置模拟**：清空结果并回到 0 时刻。

参数（时长/采样/心情/助力）放在页面下方的“模拟设置”折叠区；修改参数会清空旧结果，需要
再次点击“展示模拟结果”。进度条、开始/暂停/快进和播放速度均已移除。

## 5. 产率与曲线口径

### 5.1 心情曲线

- Y 轴 0–100（百分点），每条线一个干员。
- `operatorsAt(view, room)` 使用**当前时刻**的引擎状态判断
  `工作 / 休息 / 待命 / 已归零`，不使用未来采样点近似。
- 虚线为当前回放位置 `cursor / 3600`。

### 5.2 产率曲线

- 生产舱室（会客室/制造舱/培养舱）的 `rate` 是**相对基础产率的倍率**：
  `(1 + efficiency/100) × (1 + 0.4 × N)`。
  图表乘以 100 显示为“基础产率的百分比”（例如 2.2 → 220%）。
- 中枢没有产出，`rates["中枢"]._total` 是 `centralBonus`（百分点），图表直接显示
  `%`，不再乘 100。
- 培养舱按产物拆分；图表上方用“晶植/菌类/矿物”标签一次只显示一种产物，纵轴按当前产物
  单独计算。其他舱室一条 `_total`。
- 图表数据按“固定步长 + 换班/产率跳变点”压缩到约 720 点，避免 34,560 个 SVG 点造成
  卡顿；统计和日志仍使用完整历史。
- 换班前不足 1 小时的全员停工在图上不画成 0 点，避免出现瞬间掉到 0 的竖线；完整历史和
  积分仍按真实停工计算。
- 每张产率图下方给出积分与平均：生产舱室为“等效小时 / 平均倍率”，中枢为“%·h / 平均
  恢复百分比”。积分使用完整历史、按台阶累加，不受图表降采样影响。
- `StepStats` 的“累计产出”是 `rate × 有效工作小时`（等效小时），“均产”是该累计值
  除以有效工作小时，即平均倍率。

> 如果中枢曲线贴底为 0、生产曲线只随人数变化，优先检查第 3 节的单位换算，
> 而不是图表代码。

## 6. 助力

- 每天最多 2 次，每次 `+30` 点心情，上限 100。
- 按自然日放置：`dayStart + hour:minute`，只保留落在模拟区间内的条目。
- 目标必须是 `scheduledNames(config.rooms)` 中的已排班干员；未排班的人在选择器里
  应显示“未排班”，而不是“已安排至其他工位”。
- `options.assist` 只决定默认次数（2 或 0），模拟页可以独立覆盖；该覆盖不回写排班配置。

## 7. 存储

`riic:endfield:step:v1`：

```json
{
  "version": 2,
  "controls": { "startHour": 0, "maxHours": 24, "sampleSec": 60, "speed": 100 },
  "moods": { "干员A": 100 },
  "work": { "干员A": true },
  "boost": { "dailyCount": 2, "currentDay": 0, "days": [{ "list": [...] }] }
}
```

- **只保存模拟参数**；人员、设施、换班时间始终来自 `Workspace.manual`，旧存档里的
  `rooms` 不会覆盖共享排班。
- `loadStepConfig` 兼容 v1：缺少 `controls` 时使用默认值；非法数值会被夹到合法范围。
- `local-settings.ts` 的“清除本地数据”会删除该键。

## 8. 访问门禁与本地开发

生产设计是“管理员预览”：每个页面、API 和静态请求都会调用账号服务的
`/api/platform/endfield-access`，只有数据库中的有效管理员得到 204，否则返回
`404 Not Found`（`Cache-Control: private, no-store`）。

本地开发额外规则（`apps/endfield/src/server/admin-access.ts`）：

- `NODE_ENV !== "production"` 且 `APP_DEPLOYMENT_ENV !== "production"`；
- 没有配置 `PLATFORM_API_ORIGIN` / `ENDFIELD_ACCOUNT_ORIGIN`；
- 请求 Host 是 `127.0.0.1` / `localhost` / `::1`；

同时满足时直接放行，保证 `npm run dev:endfield` 后本机可访问。配置了账号服务或
生产构建时，门禁逻辑完全不变，真实管理员账号仍按原路径校验。

## 9. 已知限制与排查清单

1. **只接入手动排班**：B 班为空时，换班后舱室无人、按规则停工；自动结果里的单班舱室
   （`single: true`）无法直接进入模拟，`使用当前双班结果` 遇到单班会整体跳过。
2. **班组内提前耗尽**：只在原班组时间内休息，不提前换班；全舱休息时产率为 0，回满后
   继续工作。跨天心情不会重置。若画面上出现 0，先确认该时刻是否“全员休息 / B 班为空 /
   中枢当前班组没有恢复技能”；这些都是规则允许的停工，不是心情重置。
3. **采样/历史上限**：见 4.5；长时长 + 高精度回放可能丢失最早样本。
4. **曲线降采样**：图表最多绘制约 720 个点（保留换班/产率跳变点）；统计和日志仍使用
   完整历史，不受降采样影响。
5. **助力目标选择器**：未排班干员应显示“未排班”；如果仍显示“已安排至其他工位”，
   说明 `OperatorPicker.unavailableLabel` 没有传下去。
6. **中枢曲线**：显示的是恢复加成百分点；若恒为 0，先查 `restore` 是否已乘 100。
7. **生产曲线**：显示倍率 ×100；若所有线都贴着 100% 且只随人数变化，同样是
   `effMap` 未乘 100。
8. **统计表**：中枢不参与产出统计；干员心情表使用遍历统计，不再展开 40,000 个参数。
