# 两站共享交互组件

方舟和终末地使用相同的基础交互；颜色从各应用的语义变量继承。

- `Combobox`：方舟森空岛账号切换的完整基础组件，支持分组、多选与搜索。方舟的 `apps/arknights/src/components/ui/combobox.tsx` 仅转导出，避免两个版本漂移。
- `FilterSelect`：单选筛选。传入 `options: { value, label, disabled? }[]`、`value` 和 `onValueChange(value: string)`；搜索按标签匹配，关闭弹层恢复已选标签。通过 `emptyText` 提供当前语言的空状态。`disabled` 应显式传递，尤其在异步任务或禁用的 fieldset 内。
- `SearchInput`：沿用方舟技能查询的 44px 搜索框。传入 `label`、`value`、`onChange`；需要清空按钮时传入 `onClear` 和本地化的 `clearLabel`。清空后焦点回到输入框。`containerClassName` 用于外层布局，`className` 用于输入框。
- `SelectionButton`：`selected` / `onSelectedChange` 控制选择状态，使用 `aria-pressed`。
- `Tabs`：水平模式为顶部切换栏、下方内容；窄屏可在 `TabsList` 上启用横向滚动。方向键移动焦点，Enter / Space 激活，除非调用方明确启用自动激活。
- `CompactTabsList`：两站森空岛数据分类共用的小型 Tab 栏，窄屏自动换行，配合 `Tabs`、`TabsTrigger` 和 `TabsContent` 使用。
- `scrollbars.css`：两站共用的细滚动条主题及原生回退样式。配合 `PageScrollbar` 和滚动区域的 `data-yeye-scroll` 使用，弹窗应标记可滚动的内容区，保留标题与底部操作区。
- `FilterRow`：两站技能页的筛选行，左侧固定宽度标签，右侧选项可局部横向滚动。搜索框放在全部筛选行下方。

组合筛选示例：

```tsx
<FilterSelect
  aria-label="设施筛选"
  value={facility}
  onValueChange={setFacility}
  emptyText="没有匹配设施"
  options={[{ value: "all", label: "全部设施" }]}
/>
```
