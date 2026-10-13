# Gacha title artwork

Original, unmodified game title PNGs from the Chinese branches of:

- https://github.com/ArknightsAssets/ArknightsAssets2/tree/cn/assets/dyn/ui/gacha
- https://github.com/ArknightsAssets/ArknightsAssets/tree/cn/assets/torappu/dynamicassets/ui/gacha

Game artwork belongs to Hypergryph and the respective collaboration rights holders.
`src/generated/gacha-titles.json` records each pool's original repository, commit,
path, Git blob hash, and image dimensions. Usually `title.png` or `logo.png`
provides a standalone title. Some animated titles are split into multiple sprites:
`LIMITED_76_0_1/title.png` is only the Chinese subtitle. Explicit layouts in
`scripts/gacha-title-layouts.mjs` assemble those original PNGs in the page without
modifying them. The manifest records every layer's provenance and position, and
the sync check requires all configured layers. Layout positions are a static web
adaptation of the game title, not an exported animation or prefab.
Missing titles or failed layers use the website's text heading. Character names,
similar pool names, and full banner crops are not used to infer a title.

Run `npm run assets:gacha-titles` to update and `npm run assets:gacha-titles -- --check`
to verify local files without network requests. Existing historical titles are
retained when the upstream source no longer contains that pool. This command is
independent of the daily operator sync workflow.

The sync also uses the existing `sharp` dependency to extract an alpha-weighted
representative hue into each title's `accent`. Composite titles include all their
layers; transparent, near-black and neutral pixels are ignored. Neutral artwork
uses a null accent so the page can fall back to theme colors. No image pixels are
changed, and no color extraction runs in the browser. Use
`npm run assets:gacha-titles -- --colors-only` to refresh colors from local assets.
