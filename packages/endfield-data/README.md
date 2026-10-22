# Endfield display data

`catalog.json` is a small, generated display catalog from [rmxlinux/EndfieldData](https://github.com/rmxlinux/EndfieldData).
That repository contains tables and resource identifiers, not image files. The matching PNGs come from
[555me/EndfieldAssets](https://github.com/555me/EndfieldAssets) and are served locally under `apps/endfield/public/images/game`.
Game artwork and game data remain the property of their respective rights holders.

Run `node scripts/sync-endfield-display-data.mjs` to reproduce the pinned snapshot.
`sources.json` records both revisions, selected tables, source URLs, byte sizes and SHA-256 checksums.
The script preserves 64-bit localization IDs, downloads only the selected portraits, weapon icons, ship skill icons and workbench artwork,
and rejects failed/non-PNG downloads. Update the two pinned revisions explicitly when reviewing a data update.

This package is presentation-only. It does not replace the Arr_Solver catalog, its supported operators, or calculation rules.
An unknown operator/image gets a readable UI fallback; a character's default weapon is never treated as their equipped weapon.

`workbench-sources.json` selects original facility, resource and close-button PNGs; `workbench.json` is its generated local mapping.
Facility colors follow the pinned `SpaceshipRoomTypeTable`. Resource item IDs resolve through `ItemTable`.
The manufacturing symbol uses the available `_limit` variant from the same unpacked sprite set.
Category images identify production types, not a promise that a particular item tier will be manufactured.
