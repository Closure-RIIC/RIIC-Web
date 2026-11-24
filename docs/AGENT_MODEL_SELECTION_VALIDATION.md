# Agent model and billing validation

This document describes the integrated model/gateway/billing behavior and its
functional acceptance coverage. Final push/release gates must be run against the
candidate commit using the current target branch workflow; development results
below do not replace those gates.

## Functional acceptance

- Apply migrations 0032 (model selection and combined settings) and 0033 (nullable
  call/run cache-write counters) through the normal migration runner. Historical
  policies and settled charges remain unchanged; counters are not backfilled.
- Configure the private gateway routes and credentials, publish administrator-entered
  rates and a multiplier, and enable each optional model only when its route is ready.
  GPT requires an explicit image reservation policy. No supplier price or off-peak
  date is automatically published by deployment.
- Default DeepSeek routes through relay DeepSeek, configured GLM and enabled official
  DeepSeek. Explicit GLM/GPT selections use exact routes; image requests require GPT.
  GPT defaults to medium reasoning. A failed attempt after content starts must not
  replay content through a fallback route.
- A run freezes route candidates and rates, reserves the largest candidate charge,
  and settles using the actual gateway model identity. Model settings and rates
  publish and roll back together through the existing administrative workflow.
- Request member identities in streamed response metadata and validate the complete
  provider/model against the frozen routes and rates before accepting content or
  usage. Early HTTP identity headers may describe a route that later falls back;
  they must not select a tariff. Missing or invalid member identities release the
  reservation without charging and enter reconciliation. A verified identity remains
  available after a partial response or cancellation.
- The server-side stream consumer finalizes success, failure and cancellation even
  when a native stream rejection bypasses SDK callbacks. This path shares the same
  idempotent settlement as those callbacks, so reservations are released once.
- Peak prices are optional for every provider. GPT long-context prices apply to the
  whole call only when total input exceeds 272000 tokens. Historical `peak: null`
  remains readable without rewriting stored policy snapshots.
- Cache-write prices are optional per route. Enabling them requires explicit prices
  for every configured base, peak and long-context tier. Ordinary input then excludes
  both cache reads and writes, and all four components are charged separately.
  DeepSeek, GLM and historical policies without write prices retain their formula.
- A reported zero write count is distinct from missing usage. Missing required write
  usage enters reconciliation; incomplete aggregates are shown as unrecorded.
  Gateway imports rebuild total input from ordinary input, cache reads and writes;
  telemetry repair does not reprice historical bills.
- Verify the model switch dialog at desktop and mobile widths, image/history
  behavior, combined rate editor, saved-version confirmation and model usage detail.
  Replies do not show a model-name badge; administration retains actual identities.

## Development validation completed on 2026-11-22

On Windows with Node 22.23.4, the integrated development tree passed:

- 54 model/gateway tests, including real SDK synthetic streams and malformed,
  absent, explicit-zero and nonzero cache-write counters.
- 24 rate/legacy pricing tests and 16 isolated PostgreSQL billing tests covering
  reservations, reconciliation, policy compatibility, aggregation and history repair.
- 20 administrative editor/render tests covering all route types and pricing tiers,
  explicit zero, removal, saved payloads and multilingual presentation.
- 20 pinned Magpie synthetic contracts covering routing, partial failure, Responses
  images/tools, cancellation and cache-write usage in both streams and the ledger.
- Workspace type checks, ESLint, translation validation, production application and
  worker builds. Independent reviews of billing, gateway and administration found
  no unresolved blocker after the reported corrections.
- Chromium checks against the production build in a temporary database at 1440px
  and 390px. The actual draft API persisted four GPT write prices and GLM zero;
  editor and saved-version confirmation had no horizontal overflow. No policy was
  published, and the temporary server/database were removed.

Earlier full-check and browser results came from preceding development trees.
They are not evidence for the final PR candidate after synchronization with develop.

The subsequent member-identity correction passed 67 model/gateway tests and 21
pinned Magpie contracts. The latter includes a synthetic route with a 20-second
first-token deadline that reproduces early HTTP headers followed by an official
fallback; production retains its 10-second deadline. These targeted results do not
replace final candidate database, build and browser gates.

## Validation boundaries

No new paid supplier request was made to validate real cache-write reporting.
The pinned gateway collapses an absent upstream write field to zero and does not
preserve GPT 12-hour cache-lifetime breakdowns. This feature supports the supplier's
default cache lifetime with administrator-entered prices; it does not change the
active tariff automatically.

Synthetic gateway and browser fixtures establish application behavior, not actual
supplier availability or pricing. Real deployment acceptance must verify private
route readiness, published prices, supplier usage and reconciliation. Local preview
accounts and their existing password hashes were preserved.
