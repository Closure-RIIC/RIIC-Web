# 专精规划

入口 `/mastery`，直接读取工作台当前 Box，计算在用户指定条件下的单技能专精方案。计算在浏览器内运行，不调用排班求解器，不回写 Box 或排班。

## 数据维护

- `scripts/mastery-rule-definitions.mjs` 按技能 ID 明确维护效果；同前缀技能按解锁的最高 index 替代，不同组效果叠加。
- `src/generated/mastery-data.json` 包含规则、干员分支和来源版本。每日同步使用 `Kengxxiao/ArknightsGameData` 固定提交的 `zh_CN/gamedata/excel/character_table.json`，并将仓库与提交写入该文件的 `source.branches`；头像来源独立记录，不得用头像版本冒充职业分支来源。
- 将该源文件下载到本地后，运行 `npm run assets:mastery -- <character_table.json路径> --game-source-sha=<40位提交SHA>`。源文件只用于生成，不能打包进客户端。兼容旧头像仓库来源的手动生成可省略该参数，但必须使用 `src/generated/arkntools/source.json` 中 `portraitsSource` 指定提交的数据；缺少新干员分支时生成会报错。
- `npm run assets:check` 校验训练技能全覆盖及描述摘要。数据同步工作流会更新分支目录；训练描述变化会阻断自动更新，必须审阅规则后加 `--review-rules` 重新生成。武道列为暂不支持，心情消耗列为计算假设。

## 计算边界

专一／二／三基础训练量为 8／16／24 小时。目标必须已拥有且精二，教官按实际精英阶段、等级解锁；目标不能兼任教官。

减半以连续训练至少五小时加用户余量判定。必须保留对应教官开启下一阶段，应用减半后才能换人。起始无预存减半，阶段结束需手动收取并开启下一阶段；不处理已经进行中的训练。

省操作方案不在阶段中途换人，仅允许最终阶段触发减半后立即换教官。极速方案增加效率教官先手、减半教官收尾的候选，通过阶段边界动态规划最小化总时间，时间相同时优先减少换人。先手时长向下取整到整秒，避免展示精度导致减半工作时间不足。

默认中枢 5% 开启、操作余量 1 分钟、其他环境零加成。环境参数由用户确认全程实际满足；假定心情、材料与训练室等级足够，不模拟休息、武道或基建产能损失。人数按技能上限，烟火点数输入限制为 0–10000。

## 共享选择组件

`OperatorPickerParts` 提供 OperatorSearch、OperatorRarityFilter、OperatorProfessionFilter、OperatorIdentity 和 OperatorRosterGrid。调用方拥有候选数据和交互状态：ManualOperboxPicker 保留练度编辑；MasteryTargetPicker 先限制候选为已拥有精二，再组合搜索、星级、职业，点击卡片单选后确认。不要将全选练度逻辑带入单选模式。

## 验证

`npm run test:mastery` 覆盖文档算例、接力余量、解锁、分支、环境叠加、失效条件，并与独立时间网格穷举对照。`e2e/mastery.spec.ts` 验证桌面／移动端筛选、计算、输入失效和登录锁；共享组件调整后运行 `e2e/manual-operbox-rarity.spec.ts` 回归。
