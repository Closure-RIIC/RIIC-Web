# 公招计算

入口：工作台「养成规划」分组中的「公招计算」，路径 `/recruitment`。

## 计算与 Box

- 输入游戏提供的最多 5 个标签，枚举 1～3 标签组合；按标签保留后的最低星级、未拥有数量和候选范围排序。
- 使用国服公招池。提供 3:50、4:00、7:40、9:00 四种常用时长；结果不代表抽取概率，标签掉落后的结果不包含在组合范围中。
- 1★ 在 4 小时起排除；2★ 在 7:40 起排除；普通 5★ 在 4 小时起出现，资深干员标签可追加 5★；6★ 必须包含高级资深干员。两种资深标签同时出现时以高星级为准。
- 个人 Box 从工作台上下文读取，沿用账号访问规则。未载入、未授权和示例 Box 显示「持有情况未知」。按干员 ID 匹配并兼容规范化名称，只有 `own: true` 才视为持有。
- 「只看可补图鉴组合」只筛选整组结果，保留完整候选名单与实际最低星级。

规则参考：[PRTS 公开招募](https://prts.wiki/w/公开招募)。交互参考：[PRTS 公招计算](https://prts.wiki/w/公招计算)。

## 数据维护

来源为项目已使用的 [Arknights Toolbox 数据仓库](https://github.com/arkntools/arknights-toolbox-data)，沿用 `apps/arknights/src/generated/arkntools/source.json` 固定的提交。`recruitment.cn > 0` 的干员构成国服公招池；职业、位置、词缀和资深标签共同参与匹配。游戏内容版权归原权利人所有，相关来源说明沿用项目资产归属约定。

更新现有干员目录后执行：

```sh
node scripts/generate-recruitment-data.mjs
node scripts/generate-recruitment-data.mjs --check
node --test --experimental-strip-types src/recruitment.test.ts
```

生成器从固定上游提交读取公开数据，不依赖浏览器请求 PRTS。检查模式离线验证数据版本、干员目录和标签完整性。新增公招干员须随上游数据更新并审查生成结果；本页不会自动追踪最新游戏更新。
