# Agent production models

The server owns the model catalog, credentials and billing. Gateway mode exposes
three stable selection IDs: `deepseek`, `glm`, and `gpt`. The initial default is
DeepSeek Flash. Its `group/riic-agent` route tries configured relay DeepSeek,
GLM, then official DeepSeek in order. Explicit GLM/GPT choices use exact routes.
Each run freezes its allowed provider/model set; tool steps retain same-turn
affinity and never replay partial output. Older clients omitting a selection
use the active catalog default. Unknown or unavailable choices fail before a run
or reservation is created.

## Configuration ownership

- Private environment: `AGENT_LLM_{DEEPSEEK,GLM,GPT}_{BASE_URL,MODEL,API_KEY}`.
  GPT uses an independent credential and the existing supplier's Responses API.
  The application explicitly sends `medium` reasoning effort, matching GPT-6.1 Sol's
  default. Each call retains a 2048-token output limit shared by reasoning and visible
  output; reasoning tokens are included in output usage and billed once.
  Legacy `AGENT_LLM_*` values apply only to the legacy default text provider.
- Gateway: `deploy/setup-agent-gateway.mjs` updates only RIIC-managed routes,
  applies the exact caller allowlist, then synchronizes `AGENT_GATEWAY_MODELS`
  and actual model IDs into the web/worker environment. Existing unrelated
  providers, credentials, local settings and rollback data are preserved. The
  managed default group is rebuilt with only its display name retained, so old
  dynamic matching, classifier and disabled-member controls cannot add candidates.
- Billing administration → Model rates: one card per public model owns its selection/display
  settings, exact provider/model tariff, currency/exchange rate, input/cache/output
  prices and image limits. Default model and service markup are shared controls.
  Capabilities, upstream routes and credentials remain server-owned.
- A single `model-settings` draft contains both rate and model policies. Publishing
  or restoring it changes both runtime snapshots in one locked transaction. The
  first visit records the existing pair as a rollback baseline. Legacy individual
  rate/model publishes also update that combined history in the same transaction.
  Optimistic checks compare both active IDs; failed validation or audit writes
  leave both policies unchanged. Existing two-model policies remain valid, and
  GPT has no guessed default price. Every candidate route, including fallback
  routes, must have matching rates. The official provider has its own rate card.
  Public selection toggles do not change the deployed fallback group. Initial
  installations require an explicitly entered multiplier; no rate policy is
  automatically published.
- GPT optionally has a long-context tariff with a 272000 input-token threshold
  and editable input/cache-read/output prices. The configured supplier rule uses
  272000: a call with total input **strictly greater** than this threshold prices
  the entire call at the second tier. Input includes cache and image usage.
  Exactly 272000 retains the base tier. Both tiers share currency, FX and markup;
  if peak pricing is enabled, each tier has its own peak prices. Adding the local
  rule initializes the upper tier at 2× input/cache and 1.5× output; administrators
  can edit those prices. Optional cache-write prices are entered separately for
  each tier; enabling them never invents a price or applies a write-price multiplier.
  Historical runs keep their original policy; missing `longContext` means the
  previous single-tier behavior.

The current supplier reference is `https://ai.codesonline.dev/v1`, with
`deepseek-v4.1-flash`, `glm-5.3-flash` and `gpt-6.1-sol` configured independently.
Deployment copies model IDs (not upstream credentials) into the web environment,
so custom supplier aliases stay aligned with billing. Changing environment files
requires gateway synchronization and service restart.

Administration shows per-model usage on the billing overview, conversation calls
and gateway requests. Aggregates include all matching calls, not just the current
page; gateway attempts deduplicate by call ID. Total input already includes cache
reads and writes. Unknown usage/cost stays null with separate counts. Prices and tier details
come from each run's original snapshot. Calculated model prices are distinct from
final ledger deductions. Only open review records count as pending review.
The overview uses call timestamps and date filters; conversation/gateway pages
use their full visible query/status/date filters.

## Optional cache-write billing

Every route can opt into a separate `cacheWrite` price through the existing
model-settings draft and publication workflow. Without that price, the existing
input/cache-read/output formula remains unchanged, including DeepSeek peak rules
and GLM rates. When enabled, every configured base, peak and long-context price
row must include a valid write price. Empty prices cannot be published; zero is
an explicit price. Removing the option removes it from all rows.

For enabled policies, ordinary input equals total input minus cache reads and
cache writes. Each category is priced once, and reservations include the highest
applicable write price. Long-context selection still uses total input. Missing
write usage prevents pricing and enters the existing review path; explicit zero
is measured usage. Historical policies and settled amounts are not rewritten.

The SDK adapter preserves the gateway's `prompt_tokens_details.cache_write_tokens`
from raw usage. Migration `0033_agent_cache_write_tokens` adds nullable counters
to calls and run usage without backfilling old data. Administration displays
unrecorded writes separately from zero; an aggregate containing any unrecorded
write count remains unknown. The gateway ledger stores ordinary input separately,
so imported total input is `in + cache_read + cache_write`. Re-importing older
telemetry can repair these counters without modifying historical call charges.

This version supports a single price for the provider's default cache lifetime
(30 minutes for the current GPT route). It does not offer a 12-hour TTL selector.
Pinned Magpie preserves total writes but drops GPT TTL breakdowns, and normalizes
an omitted upstream write field to zero. Providers must report accurate write
usage before administrators enable this tariff. No upstream cache lifetime is
overridden, and no supplier price is filled in automatically.

## Images and attachments

PNG, JPEG and WebP are decoded and checked server-side. Images are normalized to
PNG, stripped of metadata and resized to a maximum dimension of 2048 pixels.
Policy controls byte, pixel and image-count limits. TXT and Markdown are decoded
and filtered as text. Word, PDF and spreadsheets have no extraction pipeline and
are rejected; selecting a vision model does not turn those formats into images.

GPT starts disabled until its route, actual supplier rates, image limits and a
valid image budget mode are configured. The versioned model policy supports:

- `per-image` (also the default for older policies): reserve the text estimate plus
  a verified `imageTokensPerImage` bound for each image. The bound must cover the
  normalized images at the upstream default detail: the pinned Magpie bridge does
  not preserve image detail overrides. A synthetic contract is not evidence of
  supplier prices or the image bound. Do not substitute another model's patch rule.
- `shared-input-limit`: when a model step contains images, reserve 262144 input
  tokens for all text and images together. This is the existing whole-input
  reservation cap, not a per-image allowance or a second image charge. The
  `imageTokensPerImage` field is unused and may be zero; images are not free.
  Without images, retain the existing text estimate. This local reservation policy
  does not guarantee that supplier usage stays below the cap; excess usage follows
  the existing settlement review path.

Both modes also reserve the maximum output for each model step. Image encoding
length is not a token count. Final settlement uses measured input/output/cache
usage. Image and reasoning details, when available, are subsets of those totals,
never extra charges. If image detail is absent, report total input including
images; do not fabricate an exact text/image split. Images resent in follow-ups or
tool steps may incur input usage again, with actual cache discounts.

When switching an image conversation to a text model, the user explicitly chooses
to continue with text only. Original images remain in local history but are
excluded from subsequent text requests. Newly attached images require a vision
model. The browser records the chosen model and image mode per conversation;
assistant messages retain actual model metadata for history and accounting,
without displaying a model-name label above each reply. Server-side histories remain
untrusted and cannot submit executable tools or override billing identity.

## Rollout and verification

Apply migrations `0032_agent_model_selection_and_settings` and
`0033_agent_cache_write_tokens`, in that order, after the current
referral migrations
before starting the new web/worker. Existing fee snapshots and settled balances
are preserved. Prepare gateway routes, then publish rates, enabled/default model
and image settings together. New requests read rates, filters and models under
one policy lock; in-flight runs keep their snapshots. Policy publishing and rollback use the existing admin audit and
optimistic version checks. Drain current runs before changing upstream routes.

The current 262144 input reservation cap remains below the 272000 tariff threshold.
If supplier usage exceeds the reserved bound, the call still enters review and
stops subsequent steps; adding the tariff does not raise the admission limit.

The gateway is the supported GPT billing path. `AGENT_GATEWAY_ENABLED=0` retains
the legacy DeepSeek/GLM path for controlled rollback and does not expose GPT.
Keep `AGENT_ACCESS_MODE` and `BILLING_ACCESS_MODE` at their existing values.

Validation covers model/credential boundaries, file decoding, image reservations,
actual SDK usage and identity, isolated database settlement, mobile/desktop model
selection and history, and the pinned Magpie Responses bridge with synthetic
upstreams. Run `npm run test:agent-models`, `npm run test:agent-gateway`,
`node scripts/test-agent-billing.mjs`, and the agent model browser tests. The gateway
contract requires its documented pinned binary, Bun and word-guard paths. Real
supplier access, rates and vision acceptance remain deployment configuration
checks; none are inferred from a local synthetic success.

## Fallback pricing and compatibility

`AGENT_GATEWAY_MODELS` declares configured public routes;
`AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED=1` adds the separately configured
`riic-deepseek-official/deepseek-flash` fallback. Deploy configuration and web/worker
readiness together. Drain active runs before changing routes. Official credentials
use `AGENT_LLM_DEEPSEEK_OFFICIAL_{BASE_URL,MODEL,API_KEY}` and are never borrowed.

A model call reserves the maximum cost among its frozen candidate routes and
settles by the actual gateway provider/model using the original rate snapshot.
Unexpected identities and missing usage retain the existing review behavior.
Peak prices and off-peak calendar dates are optional for every rate row; currently
the two DeepSeek suppliers use peak prices. Templates do not prefill calendar dates;
administrators enter and publish them through billing administration. Updating code
does not clear or replace calendars in saved versions. JSON `peak:null` (including long-context
tiers) is accepted as no peak rule without rewriting historical records. The
public model list only reports selection readiness, labels and capabilities;
it does not generate a second price table.

Direct rollback mode also requires a published policy and exact model price.
Keep private credentials outside the repository and release artifacts; existing
access flags, account passwords and settled historical balances are preserved.
