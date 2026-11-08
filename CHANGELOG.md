# Changelog

All notable changes to RIIC-Web are documented in this file.

## [Unreleased]

### Fixed

- The 153 layout preset now defaults to a level-five control center, matching the other presets. Selecting it in setup, manual scheduling, or a new schedule poster uses five control-center slots. Saved layouts and imported facility levels remain unchanged.

## [0.7.1] - 2026-09-07

### Added

- Training Advice shares the operator picker's owned-only, rarity and profession filters and supports a persistent local recommendation blacklist.
- Help pages include tutorial videos for the main setup and scheduling workflows.
- Manual Scheduling adds facility actions and drone targets, and production details include authoritative solver totals and drone contributions.

### Changed

- Manual operator selection uses shared search, filter rows and scroll controls, with a compact aligned portrait grid and a small red Clear button beside the facility filter.
- Operator skill tooltips distinguish locked skills, and account dialogs fit narrow mobile screens.
- MAA imports validate progression limits and provide a review step before applying imported operators.
- Manual picker scroll controls and training combination cards load on demand to keep every route within its existing JavaScript budget.

### Fixed

- Integration preserves current translations, skill unlock hints and pagination when merging older feature branches.
- Production detail browser checks verify solver-provided totals and drone increments using the displayed product units.

## [0.7.0] - 2026-09-06

### Added

- The website now uses next-intl for cookie-backed Chinese and English rendering, including server-rendered document language, localized metadata, workbench pages, help pages, account flows and administration interfaces.
- Skill Reference now provides rarity, profession, facility and skill-tag filters in four dedicated rows, reusing the operator picker's controls and placing Clear selection in the page header.

### Changed

- Operator names, infrastructure-skill names and descriptions continue to use the separately loaded unpacked-game English catalog instead of being duplicated in website translation messages.
- Translation catalogs are split between ICU interface messages, structured presentation records and pure-helper namespaces, with parity and formatting validation for both locales.
- Standalone build preparation and production bundle checks can target an isolated Next.js output directory, preventing local runtime artifacts from contaminating release verification.

### For contributors

- Unit and browser coverage verifies locale-cookie migration, server rendering, translated public pages, preserved search state, intersecting skill filters, room/tag reset behavior and mobile overflow boundaries.

## [0.6.1] - 2026-09-05

### Added

- A bilingual changelog page is available from the sidebar and shares its release presentation with the version announcement dialog.
- Administrators can create drafts, preview page and dialog layouts, publish or withdraw releases, and control whether a release triggers a notification.

### Changed

- Release drafts and published snapshots are stored independently in PostgreSQL and isolated by production, development, and local environments.
- Version announcements wait until the workbench is ready, remember acknowledgement per environment, synchronize across tabs, and do not repeat for same-version edits or rollbacks.

### For contributors

- Migration `0015_release_notes.sql` creates the release-note store and imports the existing public release history.
- Validation, API, PostgreSQL integration, browser-flow, bundle-budget, and deployment-boundary coverage protect the changelog workflow.

## [0.6.0] - 2026-09-05

### Added

- Plan skill mastery from the new sidebar entry at `/mastery`, using owned Elite 2 operators from the current Box with search, rarity and profession filters.
- Compare low-interaction and fastest trainer plans, including stage handoffs, inherited halving effects, environment bonuses and a configurable handoff buffer.
- Follow a stage-by-stage timeline, inspect each trainer's unlocked infrastructure skills and copy the operation checklist. Calculations run locally without changing the Box or invoking the base-schedule solver.
- Read the new Mastery Planner guide for supported effects, calculation assumptions and data maintenance.

### Changed

- Mastery selection and manual Box editing reuse the same search and filter controls while retaining their separate selection and progression-editing behavior.
- Trainer skill details load on demand so the new planner and existing pages remain within the current download budgets.
- Mastery rules are checked against the pinned operator data during resource synchronization; input or Box changes invalidate old plans before recalculation.

## [0.5.1] - 2026-09-05

### Added

- Solved schedules now offer two clearly separated actions: update operator progression and recalculate, or copy the currently viewed result into Manual Scheduling for direct editing.
- Manual drafts created from a solved schedule identify whether they came from the original or progression-adjusted result, link back to the calculator, and ask before replacing a different saved draft.

### Changed

- Schedule Settings and progression recalculation now share the same rarity, profession, schedule-scope, and shift controls, with the schedule filters and operator filters arranged in two compact rows.
- “Owned only” and “Select all at max elite” use compact toggle controls; turning off max elite restores the exact Box configuration from before it was enabled.
- Manual Scheduling now shares the calculator's layout and shift controls, and shows the morale-recovery target immediately to the left of the shift selector.

### Fixed

- Mobile plan actions now explain whether an action changes the calculation input or edits only the displayed result, avoiding accidental navigation to the wrong workflow.

## [0.5.0] - 2026-09-05

### Added

- Administrators can create, search, edit, and delete operator-specific infrastructure skill notes from `/admin/skills`.
- The Skills catalog displays each published clarification on its exact operator skill card as a separate asterisk-prefixed line on desktop and mobile.

### Changed

- Manual skill notes are stored independently from generated arkntools assets, so routine upstream synchronization cannot overwrite editorial clarifications.
- The administration interface removes decorative product labels and numbered section prefixes, and improves search, responsive layout, feedback, and editor states.

### For contributors

- A dedicated database migration, administrator and same-origin API boundaries, public DTO filtering, and annotation identity tests cover the new workflow.
- Release `0.5.0` preserves the latest 429-operator arkntools catalog already published on `main`.
- `package.json` and `package-lock.json` record release `0.5.0`.

## [0.4.9] - 2026-09-04

### Changed

- Production now shows a localized “under development” state at `/manual` instead of loading the manual-scheduling editor; development deployments keep the complete editor available for testing.

### Fixed

- `/manual` responses now use the same private, no-store cache policy as the other workbench documents, preventing an older deployment profile from being reused after a release.

### For contributors

- Deployment-environment unit tests, production-profile browser coverage, and production/development standalone smoke checks protect the manual-scheduling availability boundary.
- `package.json` and `package-lock.json` record release `0.4.9`.

## [0.4.8] - 2026-09-04

### Added

- Personal Box users can create manual schedules with 1–12 independent shifts, per-shift durations and Fiammetta targets, conflict-safe operator assignment, local draft persistence, and MAA JSON export.
- An existing solved or progression-trial schedule can be converted into a manual draft without losing the schedule currently shown on screen.

### Changed

- Rarity and shift filters in manual Box and progression adjustment now share the same compact, keyboard-accessible option controls used by the class filters.
- Manual scheduling, manual edits, and progression adjustment consistently request a website login before exposing personal Box data.

### Fixed

- A newly selected base layout now remains authoritative through Skland restoration and subsequent solving instead of requiring a refresh or falling back to the 243 layout.
- The overview schedule now holds every room card in place with a matching skeleton while its lazy view loads, without moving the whole base vertically.
- Clearing local data no longer recreates a mounted manual draft, and an in-memory schedule handoff survives unavailable browser storage.
- Manual-schedule conversion stays outside the initial calculator bundle; route and document budgets now explicitly cover the new `/manual` page and protected navigation state.

### For contributors

- Unit, API-contract, shift-comparison, database, bundle, and sharded Chromium checks cover the integrated workflow, with focused manual-scheduling browser coverage for login, persistence, conversion, assignment conflicts, and MAA export.
- `package.json` and `package-lock.json` record release `0.4.8`.

## [0.4.7] - 2026-09-04

### Fixed

- The Skills catalog now includes the latest arkntools operators, building skills, portraits, and icons, including Makoto Yuki, Aigis, Yukari Takeba, and Koromaru.
- Automated arkntools releases now regenerate the full operator Box fixture together with the catalog, preventing a stale fixture from blocking otherwise valid resource updates.

### For contributors

- Asset synchronization validates, stages, publishes, and mirrors the full operator fixture through the same managed-file allowlists as generated catalogs and images.
- Deterministic generation and workflow contract tests protect the 429-operator, 755-building-skill resource release.
- `package.json` and `package-lock.json` record release `0.4.7`.

## [0.4.6] - 2026-09-04

### Fixed

- Current-state comparison now treats operators assigned to different rooms of the same facility type as matched, so no unnecessary placement adjustment is suggested.
- Fatigue warnings remain visible for same-facility matches, while assignments to a different facility type still require relocation.

### For contributors

- Shift-comparison regression coverage verifies same-facility matches, fatigue-only warnings, and cross-facility relocation behavior.
- `package.json` and `package-lock.json` record release `0.4.6`.

## [0.4.5] - 2026-09-04

### Fixed

- Progression adjustment now submits to the asynchronous planning queue when production queueing is enabled, keeps Live Activity visible through queue polling, and closes the dialog only after a real result arrives.
- Queue failures and interrupted polling remain visible in Live Activity instead of flashing for less than a second and silently ending the re-solve.

### For contributors

- Production-mode browser coverage rejects direct `/api/plan` calls and verifies task submission, queue feedback, polling, result handling, and shared manual Box synchronization.
- `package.json` and `package-lock.json` record release `0.4.5`.

## [0.4.4] - 2026-09-04

### Added

- The calculator can re-solve the current base layout with adjusted operator ownership and elite stages, then switch between the current and adjusted schedules with animated production values.
- The Help section includes a localized, accessible back-to-top control.

### Changed

- Progression adjustment and manual Box editing share one compact roster editor, distinguish the first three shifts, and keep long operator lists inside the dialog scroll area.
- Schedule setup uses consistent compact action buttons, a larger desktop dialog, and mobile-specific control sizing.
- The sidebar starts expanded at widths of at least 1280px and collapsed below that breakpoint.
- Skland manufacture rooms follow the displayed in-game order 3, 1, 4, 2.

### Fixed

- Progression re-solving now surfaces Live Activity feedback and closes the adjustment dialog after a successful result.

### For contributors

- Browser coverage verifies shared Box state, responsive setup controls, schedule variant tabs, production-value animation, and the Skland manufacture mapping.
- `package.json` and `package-lock.json` record release `0.4.4`.

## [0.4.3] - 2026-09-03

### Added

- English localization now covers the workbench, help, account, administration, legal, and Skland status interfaces.
- Training advice cards show the infrastructure skills associated with each recommended operator, including keyboard-accessible tooltips and target-skill highlighting.

### Fixed

- The desktop sidebar preserves its expanded state across workbench navigation and hard reloads without causing a hydration mismatch.
- English Skland status labels retain the corrected Orundum display for Originium Shard trading orders.

### For contributors

- Chromium, WebKit, production-profile, PostgreSQL, build-output, and bilingual bundle-budget coverage gate the release.
- `package.json` and `package-lock.json` record release `0.4.3`.

## [0.4.1] - 2026-09-03

### Fixed

- Administrator reproduction details recover compatible legacy layout, Box, and output-tail fields through the existing response whitelist.
- Private solver artifacts now follow the same 30-day retention window as their database summaries, and unavailable details report a specific reason.
- Website account deletion removes the account's referenced private feedback and solver-run artifacts before deleting the database account.

### Changed

- The privacy policy discloses the 30-day solver-reproduction retention window and uses a new consent version.

## [0.4.0] - 2026-09-02

### Added

- Administrators can review solver feedback by facility, mark it as unreviewed, reproduced, or fixed, and delete selected feedback records in batches.
- A dedicated solver-error view exposes failed runs with the layout, operator Box, rotation profile, shift count, and Fiammetta setting needed to reproduce them.
- Feedback and failed-run details can download a whitelisted reproduction JSON; retained CLI output tails are shown when available.

### Changed

- Administration now uses separate overview, solver-issue, and user-management pages.
- Sensitive administrator record responses are non-cacheable, redact server paths from diagnostic text, and keep successful runs inaccessible through the failed-run detail endpoint.
- Feedback filtering now runs in PostgreSQL before pagination, and private feedback artifacts are removed before their database records so failed cleanup remains retryable.

### For contributors

- Migration `0013_sudden_talon.sql` converts legacy feedback states to the new review workflow and changes the default to `unreviewed`.
- API, private-artifact, failed-plan reproduction, migration, and PostgreSQL workflow coverage protect the new administrator boundaries.
- `package.json` and `package-lock.json` record release `0.4.0`.

## [0.3.0] - 2026-09-02

### Added

- Personal planning can now use four solver lanes in parallel, with one prepared task behind each active computation so available CPU capacity is used continuously.
- The persistent queue now admits up to 1,000 active tasks, reserves up to 600 slots for new accounts, and places overflow candidates in a bounded random-selection ring.

### Changed

- Queued tasks now wake workers through database notifications, while a low-frequency safety poll keeps recovery reliable after connection failures.
- Queue progress polling uses status-aware intervals and estimates wait time from observed worker service time, reducing unnecessary requests without making progress feel stale.
- Cache hits can complete immediately without waiting for another solver lease, and each solver process reuses its verified capability information.
- Diagnostic processing now runs in the background, resumes safely after restarts, and quarantines malformed or crash-orphaned records instead of leaving them in an endless retry loop.
- Administrator metrics now distinguish solver compute time, Worker overhead, queue wait, and cache-backed results.

### Fixed

- Worker readiness no longer waits for the historical artifact recovery scan, preventing large retained record sets from exhausting the deployment health window.
- Worker notification connections now reconnect after initial handshake or socket failures without leaving the queue asleep.
- Queue schema upgrades now serialize concurrent migrations and build admission indexes online, avoiding conflicting deploys and unnecessary scheduling downtime.
- Artifact completion no longer becomes permanently pending when database confirmation is temporarily unavailable or a process crashes before its run record is created.

## [0.2.4] - 2026-09-02

### Changed

- Daily production details no longer show the solver-total estimate disclaimer; solver totals and the natural/drone estimate rows remain unchanged.

### Fixed

- Deleting all Skland data no longer runs unrelated global private-record maintenance, preventing maintenance failures from surfacing as `AIC-SYS-5000` before account cleanup.
- Successful all-data deletion now resolves the account store with the verified website user, removes every persisted Skland binding for that user, and clears the browser account state.

### For contributors

- `package.json` and `package-lock.json` record release `0.2.4`.
- Account-data deletion has direct route-level and private-artifact regression coverage.

## [0.2.3] - 2026-09-02

### Changed

- Plan results no longer repeat the same training advice in the compact details view; the dedicated training section remains available.

### Fixed

- Skland imports now show the correct operator count when Amiya has multiple forms.
- A delayed Skland restore no longer overwrites a MAA operator box imported while the restore is still in progress, while existing Skland boxes continue to refresh normally.

### For contributors

- `package.json` and `package-lock.json` record release `0.2.3`.

## [0.2.2] - 2026-09-01

### Changed

- The production plan worker now runs three isolated solver lanes, balancing queue throughput against the host CPU headroom required by the website and health checks.
- Standalone releases now synchronize their staged file tree with checksum-based rsync reuse before rebuilding and verifying the canonical archive on the server.
- Deployment helper contract v6 keeps production activation inside a five-minute observation transaction and automatically rolls back on delayed internal or public health failures.

### For contributors

- `package.json` and `package-lock.json` record release `0.2.2`.

## [0.2.1] - 2026-09-01

### Changed

- The production plan worker now runs four isolated persistent solver lanes instead of two, doubling task execution capacity while keeping per-lane protocol output isolated.
- Queue ETA calculations now use the four-lane execution capacity.
- Deployment readiness now starts and pings every configured solver lane before the task worker publishes its first heartbeat.

### For contributors

- `package.json` and `package-lock.json` record release `0.2.1`.

## [0.2.0] - 2026-09-01

### Added

- Authenticated plans can now wait in a persistent candidate ring when the 1,000-task global limit or 600-new-account limit is reached, then enter the active queue through random eligible selection as capacity becomes available.
- The plan worker now runs two isolated persistent solver lanes and reports candidate, pending, and running counts in administrator metrics.
- Queue responses now include actionable retry timing for account, network, and full-candidate-ring limits, with visible countdowns and continuous low-frequency progress polling.

### Changed

- Plan admission now enforces 100 active accounts per network, 10 starts per account and 200 starts per network in ten minutes, plus a bounded 2,000-task candidate ring.
- Plans submitted at the same instant now keep stable queue positions, while a dedicated account-history index keeps admission checks fast as the queue grows.

### Fixed

- Expired running tasks now release their account reservation and clear encrypted task input instead of permanently blocking later submissions.
- Candidate promotion skips networks already at their active-account limit, and buffered cancellations scrub encrypted payloads before releasing the reservation.
- Candidate and pending tasks remain visibly queued while automatic polling continues, without exceeding the production JavaScript budget.

### For contributors

- `package.json` is now the repository's version source and records release `0.2.0`.
