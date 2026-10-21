# 终末地按钮

`Action` 的视觉来自用户提供的 uriyoo-2.0 `ContourButton`：
`app/_components/home-story/ContourButton.tsx` 与 `app/globals.css`。
保留双层胶囊、等高线纹理、短横线、图标圆钮和按压反馈，适配当前 React / TanStack 应用。

| 属性 | 可选值 | 默认值 |
| --- | --- | --- |
| `variant` | `dark`、`yellow`、`red`、`white` | `white` |
| `size` | `default`（48px）、`sm`（34px） | `default` |
| `icon` | React 节点；省略时不留图标占位 | 无 |
| `iconOnly` | 纯图标按钮，须提供 `icon` 和 `aria-label` | `false` |

小号在触摸设备上扩为 44px，避免难以点击。宽度随文案伸展，长文案可换行。
颜色保持指定变体；暗色主题仍使用同一套按钮色板。
红色面板比来源略深，以保证小号白字可读。

```tsx
import { Action, ActionLink } from "@shared/endfield-ui";

<Action variant="yellow" icon={<Play />} onClick={run}>生成排班</Action>
<Action size="sm" variant="dark" icon={<Download />}>导出结果</Action>
<Action size="sm">无图标按钮</Action>
<Action size="sm" variant="red" disabled={pending}>断开账号</Action>
<Action size="sm" iconOnly icon={<X />} aria-label="关闭" onClick={close} />
<Action type="submit" variant="yellow" disabled={!valid}>提交</Action>
<ActionLink href="/settings" variant="dark">账号设置</ActionLink>
```

`Action` 接受原生 button 属性（含 `ref`）；默认 `type="button"`。
`ActionLink` 接受原生 a 属性，`disabled` 时移除跳转地址并阻止激活。
加载状态继续由调用方使用 `disabled`、`aria-busy` 和 `icon` 中的加载图标表达。

TanStack `Link`、`Dialog.Close` 等已有控件直接组合共享样式和内部内容，以保留其导航、焦点和弹窗行为：

```tsx
import { ActionContent, actionClassName } from "@shared/endfield-ui";

<Link to="/roster" className={actionClassName({ variant: "yellow", size: "sm" })}>
  <ActionContent icon={<Users />}>配置干员</ActionContent>
</Link>

<Dialog.Close className={actionClassName({ size: "sm", iconOnly: true })} aria-label="关闭">
  <ActionContent icon={<X />} />
</Dialog.Close>
```

纹理是共享静态 SVG mask，无每个实例独立的滤镜节点或 JavaScript 动画。
按钮样式支持键盘焦点、禁用、按下、选中、减少动态效果与系统强制配色。
