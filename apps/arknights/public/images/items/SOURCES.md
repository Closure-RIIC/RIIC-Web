# Inventory icons

Item icons use the same pinned upstream revisions as the existing project assets:

- arkntools/arknights-toolbox-data, commit 302105b1404bd488c4700d063da9dcf3661a94f0, assets/img/item/<itemId>.png.
- If absent there: yuanyan3060/ArknightsGameResource, commit bb48105cf738b41648c0a9dbb58bfbc6541e0a81, item/<iconId>.png.

Item IDs and icon IDs are mapped in src/generated/item-catalog.json. The classic ticket icons were supplied by PR #348.
The module materials `mod_unlock_token`, `mod_update_token_1`, and `mod_update_token_2` use the toolbox revision above. Their original 183×183 PNG files match the existing item icons and are copied without resizing or re-encoding. Their names are included in src/generated/item-name-catalog.json so the game translation generator can import the existing regional names.
These are Arknights game assets; their original rights remain with the respective rights holders.
