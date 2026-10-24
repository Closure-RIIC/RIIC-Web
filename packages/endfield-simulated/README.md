# 帝江号排班系统 · 步进模拟页 (Step Simulation)

> **参考实现，不参与构建。** 本目录是从原网页（`index.html` + `step.js` + `step.css`）原样保留的原始版本，
> 作为算法与交互的对照资料；它依赖 `/assets/css/*`、`/vendor/html2canvas.min.js`、`/Agent_characteristics.json`
> 等**不在本仓库**的资源，因此不能直接运行。
>
> 本仓库实际使用的实现是 `apps/endfield/src/step/`（引擎/模型/存储）与 `apps/endfield/src/components/Step*`
> （界面），移植时以本目录为参考、以 Workspace 数据为准。

步进模拟页用于将“静态排班图”转化为“动态时间线”。通过读取干员天赋、舱室策略、初始心情和排班名单，利用事件驱动引擎模拟 24/48/72/96 小时内的心情消耗、轮班切换、产出曲线及心情助力。

## 1. 页面依赖的静态数据 (API)

页面启动时会通过 `fetch` 拉取以下静态 JSON 文件，获取干员的基础元数据：

### 1.1 `/Agent_characteristics.json` (干员基础数据)
包含所有干员的属性、星级和天赋数据。
```json
{
  "operator_order": ["干员A", "干员B", "..."],
  "干员A": {
    "star": "六星",
    "attribute": "灼热",
    "精一": [
      { "name": "天赋名", "舱室": "制造舱", "类型": "心情消耗减少", "数值": 15 }
    ],
    "精二": [],
    "1_1": [],
    "2_1": []
  }
}
```

### 1.2 `/dist/agent_sprite.json` (精灵图索引)
用于将干员头像从长图中裁剪出来。
```json
{
  "image": "agent_sprite.webp",
  "agents": {
    "干员A": { "x": 100, "y": 200, "w": 120, "h": 120 }
  }
}
```

---

## 2. 核心数据接口 (SessionStorage)

步进页高度依赖主站和手动排班页在 `sessionStorage` 中写入的上下文数据。如果缺少这些数据，步进页将无法正确模拟。

### 2.1 外部依赖数据（由其他页面写入）

| Key | 数据类型 | 来源页面 | 用途说明 |
|:---|:---|:---|:---|
| `DijiangScheduleConfig` | `Object` | 主站 / 干员库 | 读取当前玩家干员的**精英化等级**与**激活的天赋**。用于计算该干员在特定舱室能提供多少效率或心情加成。 |
| `DijiangManualSchedule` | `Object` | 手动排班页 | 读取各舱室**一轮/二轮的具体干员名单**及 `mode`（single/double）。步进模拟将根据此名单建立模拟对象。 |
| `DijiangManualProduct` | `Object` | 主站 / 手动排班页 | 读取制造舱（`manufactA/B`）和培养舱（`culture`）的**产物选择**及优先级。用于计算各产品的精确产率。 |
| `DijiangManualOptimalHA` | `Object` | 手动排班页 | 读取系统算出的各舱室最佳高效/低效轮班时长（如 `{"manufactA": {"h1": 17, "h2": 7}}`）。用于设定模拟初值。 |

**外部依赖数据格式示例：**

`DijiangManualSchedule`
```json
{
  "mode": "double",
  "rooms": {
    "central": { "round1": ["干员A", null, null], "round2": ["干员B", "干员C", "干员D"] },
    "manufactA": { "round1": ["干员E", "干员F", "干员G"], "round2": [] }
  }
}
```

`DijiangManualProduct`
```json
{
  "manufactA": "exp",
  "manufactB": "weapon",
  "culture": {
    "products": ["plant", "mineral"],
    "priority": ["plant", "mineral"]
  }
}
```

### 2.2 步进页自身配置数据 (由本页写入与读取)

页面修改配置时，会自动写入以下 Key，刷新页面后保留状态：

| Key | 数据类型 | 用途说明 |
|:---|:---|:---|
| `DijiangStepRoomConfigs` | `Object` | 步进页专属的舱室配置（包括是否启用、是否两轮、切换时间点等）。 |
| `DijiangStepInitialMood` | `Object` | 各干员的初始心情值（0-100）。默认 100，允许用户手动调低。 |
| `DijiangStepInitialWork` | `Object` | 各干员的初始工作状态（布尔值，默认 true）。 |
| `DijiangStepBoostConfigs` | `Object` | 心情恢复助力的配置，按天独立存储。 |

**本页自身配置格式示例：**

`DijiangStepBoostConfigs`
```json
{
  "dailyCount": 2,
  "currentDay": 0,
  "days": [
    {
      "list": [
        { "hour": 12, "minute": 0, "target": "干员A" },
        { "hour": 18, "minute": 0, "target": null }
      ]
    }
  ]
}
```
*注：`target` 只能选择已排班的干员。每次助力恢复 30% 心情。*

---

## 3. 核心计算逻辑

步进模拟基于**事件驱动 (Event-Driven)**，每次推进（`processNextEvent`）都会寻找下一个最早发生的事件点。

### 3.1 基础速率
- **工作消耗速度**：`7.2% / 小时`。
- **休息恢复速度**：`12% / 小时`。

### 3.2 状态计算规则
1. **心情消耗减少 (Reduce)**：根据当前所在舱室、当前轮次的工作人员名单，累加其天赋中的 `心情消耗减少` 百分比。
2. **总控恢复加成 (Central Bonus)**：计算当前总控中枢正在工作的干员中，带有 `心情恢复提升` 天赋的总和。
3. **当前产率 (Rate)**：
   `(1 + Σ效率提升/100) * (1 + 0.4 * 工作人数)`
   其中，工作人数不包括心情归零或休息的干员。总控中枢的产出视为 0，只计算恢复值。

### 3.3 重要事件触发点
引擎在以下情况会自动跳转时间并记录事件：
1. 某位干员的心情降至 `0`（心情归零，停止工作）。
2. 某位干员的休息状态使其心情恢复至 `100`（心情回满，重新开始工作）。
3. 舱室发生**轮次切换**（如一轮时长用完，切换到二轮，并启用二轮干员）。
4. 触发了配置好的**心情助力**时间点（+30% 心情）。
5. 达到了配置的**曲线采样时间**（如每 1 分钟记录一次数据点，用于图表渲染）。

---

## 4. 对外暴露的控制与依赖接口

步进页主要依赖 UI 元素进行交互。算法逻辑并不向外暴露复杂的 API，只通过 DOM 事件触发：

### 4.1 核心控制按钮
- `startBtn`：从当前记录点开始按真实时间模拟。
- `fastBtn`：**快进到结束**。直接一次性跑完整个时长（24/48/72/96h），并渲染最终结果图表。
- `resetBtn`：重置所有状态。

### 4.2 外部调用
- `document.getElementById('importFromManualBtn')`：触发 `importFromManualSilent()`，强制重新从 `DijiangManualSchedule` 拉取最新的排班数据，并覆盖当前配置，触发重绘。

---

## 5. 已知限制与注意点
1. **初始心情与工作状态**：如果某干员分配在一轮，但初始时间已经进入二轮区间，且初始心情 > 0，引擎会默认让其处于“待命”状态（非工作），直到轮次再次切换回一轮。
2. **二轮空舱**：如果某个房间没有启用两轮（单轮模式），则二轮的 `timeSwitch` 永远不会触发，该房间将满负荷工作 24h，直至心情耗尽。
3. **不依赖云端**：步进模拟页面完全依赖浏览器 `sessionStorage` 和内存，没有任何后端网络请求（除了拉取静态 JSON）。
