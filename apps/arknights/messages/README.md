# Website translations

Each of `zh-CN`, `zh-TW`, and `en` contains the same UI namespaces. Simplified Chinese is the source and default language. Shared account resources live in `packages/shell/messages`; game text is generated separately.

Run `npm run i18n:generate` and `npm run check:i18n` from the repository root after changing messages or loading boundaries. Do not restore the old static `zh.ts` / `en.ts` aggregators.

See [the repository i18n guide](../../../docs/I18N.md) for loading, scanning, translation, game data, and validation conventions.
