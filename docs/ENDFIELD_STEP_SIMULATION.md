# 终末地步进模拟

入口为终末地侧边栏“步进模拟”（英文 `Step simulation`），路由 `/step`，沿用终末地的管理员访问限制。

页面从现有工作区读取干员与设施配置，可导入手动排班或当前自动排班结果，再查看 24–96 小时内的心情、换班、助力与产出变化。开始、暂停、重置、快进和曲线采样由同一份模拟状态驱动。舱室启用、换班时间、初始心情与助力设置保存在浏览器本地；名单每次从工作区导入，页面内临时人员调整不覆盖工作区。站内清空本地数据时也会清除模拟设置。

## 保留的实现

- `apps/endfield/src/components/Step*.tsx` 和 `src/routes/step.tsx`：页面及交互组件。
- `apps/endfield/src/step/`：事件时间线、工作区数据映射、本地存储和样式。
- `packages/endfield-solver/simulation.*`：复用求解器技能解锁、去重规则和速率常量的数据适配层；不增加第二套技能数据。线索概率技能不计入确定性产量。
- 引擎、工作区适配与求解器数据边界的非 UI 回归测试。

页面使用站内 React / TypeScript 与 TanStack Router，不嵌入独立 HTML 或另一套前端运行时。侧边栏复用现有折叠、选中态和移动抽屉逻辑；排班使用 `FacilityBoard`、`FacilityCard` 与 `OperatorPortrait`，干员选择复用 `RosterPage`、`DialogFrame` 和 Base UI 的焦点管理。标题、分区、按钮、提示、下拉筛选、输入框和日期标签分别复用 `PageTitle`、`Section`、`Action`、`Notice`、`Field`、`Input` 和 `Tabs`。

原独立页面的整套样式已移除。仅保留时间轴、曲线与心情条所需布局，限定在 `.ef-step-page` 下，颜色跟随站内深浅主题。模拟器通过稳定快照更新 React 状态，不在渲染过程中读取可变引用；播放速度不受曲线采样间隔影响。

步进引擎用于指定初始心情、起点和有限时长的过程回放；现有求解器评价器用于搜索及周期收敛后的产量评估。两者用途不同，步进页不替代求解器结果校验。

## 从 PR #586 移除的内容

| 内容 | 移除原因 |
| --- | --- |
| 明日方舟新增的独立 `/changelog` 路由及页面 | 与既有 `_workbench.changelog` 指向同一路径，导致路由生成失败；两页均渲染既有 `ChangelogPage`。 |
| 明日方舟新增的账户页面、加载页、`AccountRoute` 和重置密码页面 | 当前账户设置与认证弹窗已承接这些功能，旧书签路由已有重定向；这些文件不参与步进模拟。 |
| `SolverLiveActivity.tsx` | 没有导入者；既有 `WorkspaceLiveActivity` 已统一处理求解、森空岛同步和账户反馈。 |
| `packages/endfield-simulated/` 独立 HTML/JS/CSS 副本 | 原页面已移植至当前 React 路由；旧副本依赖另一套静态路径和 `Dijiang*` 存储键，未接入构建。保留两套页面会重复维护模拟逻辑和样式。 |

原始实现与贡献历史保留在 [PR #586](https://github.com/Closure-RIIC/RIIC-Web/pull/586) 和[固定版本的源目录](https://github.com/Courison/RIIC-Web/tree/b832785397a6b3efee3c34fa46912b1c69f94a0d/packages/endfield-simulated)。
