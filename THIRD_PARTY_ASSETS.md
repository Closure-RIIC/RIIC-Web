# Third-party asset sources

## Wish-page fonts

The wish page uses Long Cang and ZCOOL QingKe HuangYou from the `zhe-pian-da-di-font-pack` repository. Both are distributed under SIL Open Font License 1.1; license texts are included under `public/fonts/wishes/`.

## Wish-page background music

`public/audio/wish-wall-bgm.mp3` is an audio-only extraction of the user-provided Bilibili video [BV1NQuX6DEVx](https://www.bilibili.com/video/BV1NQuX6DEVx/), used as optional background music on the wish page. The original video and audio rights remain with the uploader and other respective rights holders; this project does not claim ownership.

## arkntools data and building-skill assets

Operator metadata, building-skill icons, and the generated presentation catalogs under the following paths come from the public [`arkntools/arknights-toolbox-data`](https://github.com/arkntools/arknights-toolbox-data) repository:

- `public/images/building-skills`
- `src/generated/arkntools`

The repository's updater code is published under the MIT License. Arknights game data, names, and descriptions remain the property of their respective rights holders.

## ArknightsGameResource portraits

Operator portraits under `public/images/operator-portraits` come from the public [`yuanyan3060/ArknightsGameResource`](https://github.com/yuanyan3060/ArknightsGameResource) repository. Its README identifies the images as Arknights game assets owned by Hypergryph and limits the repository's purpose to learning and exchange. The resource repository carries an [AGPL-3.0 license](https://github.com/yuanyan3060/ArknightsGameResource/blob/main/LICENSE); this frontend copies only the public PNG artifacts and does not execute code from that repository.

`src/generated/arkntools/source.json` records the exact data and portrait commits and resource counts used by the current checkout. This project does not claim ownership of the game assets.

The frontend consumes only public JSON and PNG artifacts. It does not execute private downloader or unpacking workflows, does not require access to private repositories, and never opens pull requests or writes to either upstream repository.

## Rainyun partner mark

The Rainyun logo at `public/images/partners/rainyun-logo.png` was provided for this site integration and links only to [Rainyun](https://www.rainyun.com/riic_). The Rainyun name and logo remain the property of their respective rights holder; this project does not claim ownership of the mark. The image is bundled locally, so loading the page does not contact Rainyun before a visitor chooses the link.

## Site icon

The Closure artwork at `assets/branding/closure-site-icon.png` was provided for this site integration. The generated Next.js, Apple touch, and favicon variants preserve the supplied artwork and transparency. Arknights character designs and related rights remain the property of Hypergryph and their respective rights holders; this project does not claim ownership of the artwork.

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

- Font file: `src/app/fonts/Bender-Bold.otf`
- Font SHA-256: `36DE62CF8B651E3A05D2E93352992FCB684B02EE72109FD7E2A3C134D57AF4F2`
- License: SIL Open Font License 1.1, preserved verbatim in `src/app/fonts/Bender-OFL.txt`
- License SHA-256: `7F18EC1EBB6B50E3ED0F74B2C61F25B8D7CD69E43F4DE66E991BCFD3C419A8BB`

The font is self-hosted by Next.js. Runtime pages do not request the font from 1001 Fonts, Hypergryph, or another third-party font CDN.
