# TanStack Start migration — production baseline

## Scope and provenance

- Baseline: production commit `d31a6ae7c7b0b21d24b696aca9a14dda513d84a0`.
- Production branch: `release/tanstack-start-20261014`, incorporating the latest main maintenance changes; independent worktree and dependencies. Development uses a separate `migration/tanstack-start-development` branch based on develop.
- Original worktree and the earlier migration worktree remain separate. The original tracked working diff was checked against the earlier snapshot and is unchanged.
- All 40 baseline page entries and 68 API route entries have corresponding Start routes, including optional/splat routes and redirects.
- The baseline's Agent, billing, inventory, gacha, Mower, account health, preferences, plush gallery, wishes and administration features are preserved.
- No database schema, migration or production data changes are part of this migration.
- Local previews use synthetic build IDs and must not be treated as deployed Git releases. CI artifacts identify the exact release commit and tree.
- Result generation wireframes and card reveal animations have been removed. Ordinary loading skeletons remain; completed cards render directly.

## Runtime changes

| Previous implementation | Current implementation |
| --- | --- |
| Next App Router | TanStack file routes in `src/routes` |
| Server Components, request headers/cookies | Authenticated `createServerFn` handlers and Start request APIs |
| Next route handlers | Standard Request/Response handlers, preserving methods, streaming bodies and dynamic parameters |
| next-intl | use-intl with request locale and server-loaded messages |
| next/dynamic | React.lazy/Suspense; ClientOnly for browser-only code |
| next/font and next/image | Local font assets and native images |
| Next standalone | Nitro Node server in `.output/server/index.mjs` |
| Next environment loader | Explicit dotenv loader with existing precedence |

Versions verified against npm on 2026-10-14: Start 1.169.1, Router 1.170.44, Vite 8.3.4, Nitro 3.0.260903-beta. Node must be at least 22.12. Nitro's current adapter is a beta dependency; the lockfile pins the tested dependency graph.

Only explicitly allowed public configuration is compiled into the client. Auth, authorization, feature access, owner checks and mutations remain server-side. Plan artifact data crosses the server-function boundary as JSON after the existing ownership checks.

Private documents use no-store caching. Existing versioned image caches, WASM assets, compression and the development tutorial-video proxy are retained. Scrollbars mount inside hydrated page boundaries; initializing them from the root can mutate still-dehydrated child DOM. The library stylesheet loads before the existing application theme.

## Build and deployment

```powershell
$env:APP_DEPLOYMENT_ENV='production'
$env:SKLAND_FEATURE_ENABLED='1'
$env:ACCOUNT_CLOUD_SYNC_ENABLED='1'
$env:APP_BUILD_ID='<release commit SHA>'
npm ci --no-audit --no-fund
npm run build
npm run worker:build
npm run check:bundle-budget
npm run check:build-traces
npm run check:production-client
# Only for the local HTTP preview; real deployments keep production and HTTPS.
$env:APP_DEPLOYMENT_ENV='local'
npm start -- --hostname 127.0.0.1 --port 5178
```

Use the exact deployment profile. In production NODE_ENV, setting APP_DEPLOYMENT_ENV=local does not enable the production Skland feature. The production profile explicitly enables it, matching the baseline release workflow.

The independent artifact includes public assets, runtime dependencies, Drizzle migrations, bundled administrative commands and all three workers: plan, quality and Agent. It does not need source files or a root node_modules directory to start. Solver binaries, private storage and secrets remain external.

The release stage requires an absent destination outside the worktree plus RELEASE_SHA and RELEASE_TREE_SHA. Local smoke artifacts use all-zero synthetic identifiers and must never be published.

The deployment and preflight workflows now require helper contract **7**. Existing authorization, SHA verification, branch policy, environment gates and health checks remain in place. The host helper is maintained separately; its contract 7 upgrade must pass its own checks and be installed before either deployment. It must support:

1. Artifact kind `riic-web-tanstack-start` and the `.output` layout.
2. Starting the Node entry and running the bundled operational commands.
3. Supplying the sealed runtime environment at the new path, without putting it in the artifact.
4. The plan, quality and Agent worker working directories.
5. Existing readiness, SHA, solver, observation-window and rollback checks.
6. Rolling back atomically to the previous Next release, including its old directory layout.

Do not bypass the contract check to publish. Verify the installed helper, worker adapters and reverse proxy before merging the application release.

## Local validation

Local results, CI, deployment and user acceptance are separate gates.

- Production build, TypeScript, ESLint, i18n, repository hygiene and asset checks passed.
- 862 non-UI business/API tests passed; 3 existing optional cases skipped.
- 22 database integration tests passed against a new local PostgreSQL database with limited runtime and migration roles, including billing, Agent resources and wishes.
- Six production migration e2e scenarios passed: public SSR/404/metadata, locale, hydration/navigation, mobile legal/help links, static compression/cache, and real sessions/role boundaries/CSRF/logout.
- Release output, client feature boundary and existing bundle budgets passed with Skland enabled. First-load JavaScript was approximately 1.17 MB raw / 385 KB gzip; existing limits were not increased.
- A harmless private environment canary was absent from public build files.
- The separately staged Node artifact started and returned the expected preview build ID.
- The final preview at port 5178 also passed real sign-in, session role, administrator API permission and sign-out checks for all three isolated preview accounts. Its production build runs with development deployment settings to enable Skland and allow loopback website authentication. Skland uses a new random session key and the existing HTTP exception on the loopback-only listener. Its availability, QR/credential method discovery and consent/authentication gates passed; actual upstream authorization remains user acceptance.
- The final combined production e2e run passed all 29 scenarios, including the six migration scenarios above and baseline coverage for gacha, Mower, settings, real wish submission/session renewal and scrollbars. The three scrollbar failures from the earlier run were fixed by restoring stylesheet order.

UI unit tests were not run, per repository rules. The existing hooks rendering test and Agent card rendering test remain in the test suite and CI; neither was deleted or bypassed in CI. This task did not trigger remote CI or deploy.

The optional Skland-disabled artifact profile still fails the strict client text scan because several existing help/business chunks contain Skland wording. This failure is recorded; its gate was not weakened. The enabled production profile used by the current release workflow passes.

## Manual acceptance — pending user verification

Use the preview at http://127.0.0.1:5178 and the isolated preview accounts supplied in the task handoff. Data is not production data. Skland login is enabled; the user supplies authorization through the existing QR/credential flow. The local Windows solver is connected; the staged artifact passed readiness and a real public-sample calculation. Model providers, payment services and email delivery remain unconfigured. Result cards should appear directly after the ordinary loading skeleton, without the generation wireframe animation.

| Step | Entry and action | Expected result |
| --- | --- | --- |
| 1 | Open /, hard refresh, then open /wishes from the footer | Latest baseline layout and footer; no old page version; wishes form loads |
| 2 | Switch to English, visit /training and /skills, then reload and go back | Language, title and navigation remain consistent |
| 3 | Open /manual, /mower, /mastery and /recruitment | Forms and filters work; existing local state is preserved; no horizontal overflow |
| 4 | Open /skland, its inventory/infrastructure tabs, /inventory and /gacha | Tabs, login prompts, filters and account selection render; refresh preserves the URL |
| 5 | Open /settings and /account-health | Settings persist after reload; signed-out states and session controls are clear |
| 6 | Open /help/beginner and import guides; follow links with query parameters | The intended guide step opens, and back/forward restores the selected step |
| 7 | Sign in as the ordinary test user, then sign out | Session persists across refresh, and signing out removes protected access |
| 8 | Sign in as reviewer; open /admin, /admin/issues, /admin/quality and /admin/wishes | Reviewer pages load; /admin/users, billing and Agent administration remain forbidden |
| 9 | Sign in as administrator; open /admin/users, /admin/billing and /admin/agent | Current administration UI loads, refresh works, scrolling and dialogs work |
| 10 | As administrator open /agent and /billing | Protected pages load. Actual model calls, recharge and payment reconciliation require separate configured-service acceptance |
| 11 | Open /plush; drag/press a character; change between desktop and 390px mobile width | Gallery interaction and responsive layout remain usable |
| 12 | In desktop and reduced-motion mode, scroll long pages, sidebar, dialogs and dropdowns | Scrollbars remain visible when used; drag and keyboard navigation work; closing dialogs restores page scrolling |
| 13 | Open /privacy and /terms at mobile width, then switch language | Full text, images, links and document titles render correctly |
| 14 | Open an unknown URL and a protected URL while signed out | Real 404 responses; no protected HTML data |

Mark each applicable row after user testing. A local green build alone is not release approval.

## Release readiness still requires

- User acceptance above, including real solver/Skland/model/payment/email flows in an appropriate configured environment.
- Required remote CI and the supported browser matrix.
- Host deployment helper contract 7 and a verified old-release rollback.
- Reverse-proxy/CDN verification of compression, no-store private HTML, cookies and long-lived streaming responses.
- Deploy only the reviewed migration commit through the existing release policy. Track production in PR #510 and development in PR #511; their CI and deployment records are the source of release status.

## Official guidance used

- [Migrate from Next.js](https://tanstack.com/start/latest/docs/framework/react/migrate-from-next-js)
- [Production checklist](https://tanstack.com/start/latest/docs/framework/react/guide/production-checklist)
- [Hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)

The migration follows the guide's emphasis on URL/metadata parity, server-side authorization, production-adapter testing, cookie compatibility, backward-compatible database state and an independently runnable rollback target.
