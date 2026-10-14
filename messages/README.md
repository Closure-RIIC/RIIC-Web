# Website translations

`zh.ts` and `en.ts` assemble the use-intl catalogs from the core JSON files and
`helpers/<locale>/` namespaces. The namespaces used by pure presentation helpers
have separate JSON files so unrelated page copy stays out of initial JavaScript. Use
`useTranslations` in React components and `getTranslations` in server pages and
metadata. Keep interpolated values in ICU messages; use `t.rich` for links and
styled text. Run `npm run check:i18n` after editing both catalogs.

`records/` contains structured presentation labels and help-page data consumed
through use-intl's `raw` API. These are kept separate from the typed ICU message
schema because arrays are not translation keys. Helpers in `src/i18n/helpers`
provide explicit-locale formatting for pure presentation functions, without a
global current-language variable.

Language is selected by the `riic-locale` cookie (`zh` or `en`). Existing
`infra-demo-locale` browser preferences migrate once when there is no valid cookie.
URLs, business identifiers and exports do not change with language.

Game names and skill descriptions are a separate catalog in
`src/i18n/game-catalog.ts`. Preserve its generated records and manual overrides;
do not copy game text into website messages. The English game catalog loads on
demand. User-authored skill notes remain user content.

The use-intl/ICU runtime increases the measured initial client payload by about
78 KB raw (22 KB gzip) versus the previous bilingual shell. Bundle ceilings allow
90 KB raw / 26 KB gzip for this migration; independent page chunks and the lazy
game catalog/compact schedule boundaries are still checked.
