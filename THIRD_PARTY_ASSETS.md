# Third-party asset sources

## 卫戍协议匹配房间：界面参考与美术资源来源

本功能的大厅、协议选择页及四人等待室的布局、交互和美术表现参考了 [卫戍协议：盟约](https://wei.linxia.dev/)。本提交实际复用了该公开页面中的部分美术资源和界面样式，包括背景、点阵徽标、协议页 SVG 插画、23 个盟约图标、等待室装饰立绘及按钮图标，并非全部由本项目原创。

- 来源页面：[https://wei.linxia.dev/](https://wei.linxia.dev/)
- 静态资源来源：`https://wei-static.linxia.dev/`
- 采集日期：2026-10-25；文件清单与 SHA-256 见 `apps/arknights/public/images/defense-reference/source.json`。
- 静态素材均在本地加载，不热链原站，不接入或复用原站账号、玩家数据、统计或游戏服务。
- 原站作者与素材原始权利人保留相应权利。来源备注不等于取得再分发授权，也不将第三方内容自动纳入本仓库许可证；合并、发布前仍需维护者核对授权范围。
- 装饰立绘仅用于房间界面展示，不表示用户持有对应干员。

## Shared account form controls

The OTP input and password-strength controls in `packages/shell/auth/` retain their Interior component attribution (copyright 2026 ozzy) and MIT license in `packages/shell/auth/LICENSE`. The original Arknights import paths re-export these shared controls.

## Wish-page fonts

The wish page uses Long Cang and ZCOOL QingKe HuangYou from the `zhe-pian-da-di-font-pack` repository. Both are distributed under SIL Open Font License 1.1; license texts are included under `apps/arknights/public/fonts/wishes/`.

## Wish-page background music

`apps/arknights/public/audio/wish-wall-bgm.mp3` is an audio-only extraction of the user-provided Bilibili video [BV1NQuX6DEVx](https://www.bilibili.com/video/BV1NQuX6DEVx/), used as optional background music on the wish page. The original video and audio rights remain with the uploader and other respective rights holders; this project does not claim ownership.

## arkntools data and building-skill assets

Operator metadata, building-skill icons, and the generated presentation catalogs under the following paths come from the public [`arkntools/arknights-toolbox-data`](https://github.com/arkntools/arknights-toolbox-data) repository:

- `apps/arknights/public/images/building-skills`
- `packages/arknights-domain/src/generated/arkntools`

The repository's updater code is published under the MIT License. Arknights game data, names, and descriptions remain the property of their respective rights holders.

## ArknightsGameResource portraits

Operator portraits under `apps/arknights/public/images/operator-portraits` come from the public [`yuanyan3060/ArknightsGameResource`](https://github.com/yuanyan3060/ArknightsGameResource) repository. Its README identifies the images as Arknights game assets owned by Hypergryph and limits the repository's purpose to learning and exchange. The resource repository carries an [AGPL-3.0 license](https://github.com/yuanyan3060/ArknightsGameResource/blob/main/LICENSE); this frontend copies only the public PNG artifacts and does not execute code from that repository.

`packages/arknights-domain/src/generated/arkntools/source.json` records the exact data and portrait commits and resource counts used by the current checkout. This project does not claim ownership of the game assets.

The frontend consumes only public JSON and PNG artifacts. It does not execute private downloader or unpacking workflows, does not require access to private repositories, and never opens pull requests or writes to either upstream repository.

## Rainyun partner mark

The Rainyun logo at `apps/arknights/public/images/partners/rainyun-logo.png` was provided for this site integration and links only to [Rainyun](https://www.rainyun.com/riic_). The Rainyun name and logo remain the property of their respective rights holder; this project does not claim ownership of the mark. The image is bundled locally, so loading the page does not contact Rainyun before a visitor chooses the link.

## PRTS assistant pointer

`apps/arknights/public/images/agent/prts-cursor.png` is a static frame of the fan-made PRTS hand cursor from [Montag178/arknights_cursor](https://github.com/Montag178/arknights_cursor/blob/38e08a598088d444f0194ea732dd829069d14895/hand.gif), pinned to commit `38e08a598088d444f0194ea732dd829069d14895`. It is a recreation, not an official game extraction.

- Source GIF SHA-256: `5cd252265810f88c8df83c2b6e06e74d98964eb62694e749a3bd412cc67f4669`
- PNG SHA-256: `b26198cc9051beb0e4f1865322f42bb5344ab92f5192ab504fa7c3133db41849`
- Conversion: Sharp 0.35.5, GIF page 0, trim transparent margins, resize into a transparent 96 x 96 square with `fit: "contain"`, encode as PNG.
- Upstream license: Unlicense, preserved in `apps/arknights/public/images/agent/PRTS-CURSOR-LICENSE.txt`.
- The minimized assistant uses its luminance as a CSS mask to follow the current theme. The PNG is served locally; no upstream request is made at runtime.
- Arknights artwork remains the property of Hypergryph and its respective rights holders. This project does not claim ownership of the artwork.

## Site icon

The Closure artwork at `assets/branding/closure-site-icon.png` was provided for this site integration. The generated website, Apple touch, and favicon variants preserve the supplied artwork and transparency. Arknights character designs and related rights remain the property of Hypergryph and their respective rights holders; this project does not claim ownership of the artwork.

Run `npm run assets:site-icon` after updating the source PNG. CI regenerates the browser variants and rejects stale output.

## Updating

The `Sync arkntools assets` GitHub Actions workflow performs shallow sparse checkouts of both public sources once per day at 10:17 Asia/Shanghai and opens or refreshes a pull request in this frontend repository when generated content changes. It uses the repository-scoped `GITHUB_TOKEN`; maintainers must enable **Allow GitHub Actions to create and approve pull requests** in the repository Actions settings. The workflow creates pull requests but never approves or merges them.

For a local, explicitly reviewed update:

```powershell
git clone --depth 1 --filter=blob:none --sparse https://github.com/arkntools/arknights-toolbox-data.git .tmp/arkntools-data
git -C .tmp/arkntools-data sparse-checkout set --no-cone /assets/data/character.json /assets/data/building.json /assets/locales/cn/character.json /assets/locales/cn/building.json /assets/locales/cn/term.json /assets/img/building_skill /LICENSE /package.json
git clone --depth 1 --filter=blob:none --sparse https://github.com/yuanyan3060/ArknightsGameResource.git .tmp/arknights-game-resource
git -C .tmp/arknights-game-resource sparse-checkout set --no-cone /avatar/char_*.png
$sourceSha = git -C .tmp/arkntools-data rev-parse HEAD
$portraitsSha = git -C .tmp/arknights-game-resource rev-parse HEAD
npm run assets:sync:arkntools -- --source .tmp/arkntools-data --source-sha $sourceSha --portraits-source .tmp/arknights-game-resource --portraits-source-sha $portraitsSha
```

Scheduled updates fail closed when upstream removes a managed file or reduces the operator count. After reviewing a legitimate removal, rerun the manual workflow with `allow_removals` enabled. The generator stages and validates the complete result before replacing managed directories.

No runtime page or API route fetches data from either upstream. Production builds always use the reviewed, Git-tracked snapshot in this repository.

## Bender Bold

Numeric UI text uses the Bender Bold font distributed in the public [1001 Fonts Bender package](https://www.1001fonts.com/bender-font.html). The downloaded package identifies the typeface as Bender Bold Version 1.000 (2009), designed by Oleg Zhuravlev and Gladkikh Ivan and distributed by Jovanny Lemonad.

- Font file: `packages/ui-primitives/fonts/Bender-Bold.otf`
- Font SHA-256: `36DE62CF8B651E3A05D2E93352992FCB684B02EE72109FD7E2A3C134D57AF4F2`
- License: SIL Open Font License 1.1, preserved verbatim in `apps/arknights/src/app/fonts/Bender-OFL.txt`
- License SHA-256: `7F18EC1EBB6B50E3ED0F74B2C61F25B8D7CD69E43F4DE66E991BCFD3C419A8BB`

The font is self-hosted in the Vite build. Runtime pages do not request the font from 1001 Fonts, Hypergryph, or another third-party font CDN.

### 具体复用范围

- 大厅背景与徽标：`public/images/defense-reference/hub-*.svg`。
- 协议选择页：`DefenseProtocolScreen.css`、`defense-protocol-reference.json`，包括四档协议插画、卡片与选择印章。
- 核心及附加盟约：`public/images/defense-reference/bonds/` 下的 23 个图标。
- 四人等待室：`DefenseWaitingRoom.css`、`defense-waiting-icons.json`。
- 装饰立绘原路径：`assets/char/portrait/char_4211_snhunt_2.png`、`char_350_surtr_2.png`。
- 菜单图标原路径：`assets/local/ui/outer/operator_preset.webp`。

以上文件均需结合上述第三方权利说明审查，不主张其原创权或额外授权。
