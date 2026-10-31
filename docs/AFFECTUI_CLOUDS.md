# affectUI cloud illustrations

The Agent persona dialog uses the Frost Cloud and Glow Cloud React illustrations published by affectUI. Their illustration pages identify the components as free and open source under the MIT license.

| Component | Source page | Registry source |
| --- | --- | --- |
| Frost Cloud | https://www.affectui.com/illustrations/frost-cloud | https://www.affectui.com/r/frost-cloud.json |
| Glow Cloud | https://www.affectui.com/illustrations/glow-cloud | https://www.affectui.com/r/glow-cloud.json |

Sources retrieved on 2026-10-31. License reference: https://opensource.org/licenses/MIT.

The source components are adapted in `apps/arknights/src/components/agent/clouds`. Glow Cloud retains its cloud geometry and palette. Frost Cloud now renders the round Closure vinyl avatar, with a deep charcoal center that fades radially to a translucent edge, based on the plush Closure palette and dark red gradient eyes. Its pill-shaped eyes are enlarged slightly and spaced farther apart, while pointer tracking, blink timing and spring motion are retained; the motion pivot follows the new circular outline. Local changes also expose an animation switch for compact chat avatars, react to reduced-motion preference changes, pause when the page is hidden, and remove event listeners and animation frames when unmounted. The components require no additional dependencies.

The round Closure vinyl card and the plush Closure card share the default server persona, its localized display name and the same chat request behavior. Selecting or restoring the round Closure appearance resets any previously selected built-in or uploaded persona to the default; selecting another persona returns to its plush appearance. The Glow Cloud card is labeled Pure mode (纯净模式 / 純淨模式). Selecting or restoring it clears the previous persona and sends `persona: { kind: "none" }`; both chat paths omit the default, built-in and uploaded persona content while preserving shared knowledge rules, system instructions and tool capabilities. Reply metadata records pure mode so saved replies and retries retain its identity. The round Closure avatar retains the `frost-cloud` preference key so existing selections continue to work. The previous Closure vinyl preference also maps to this avatar.
