# Agent production models

The server owns the model catalog and credentials. Configure each enabled entry
using `AGENT_LLM_DEEPSEEK_{BASE_URL,MODEL,API_KEY}` and/or
`AGENT_LLM_GLM_{BASE_URL,MODEL,API_KEY}`. `AGENT_LLM_PROVIDER` selects the default.
The legacy `AGENT_LLM_{BASE_URL,MODEL,API_KEY}` variables remain supported for
that default provider only. Credentials never fall back between providers.

For the production gateway, the verified base URL is
`https://ai.codesonline.dev/v1`. Model IDs are `deepseek-v4.1-flash` and
`glm-5.3-flash`; `ds-v4.1-flash` is not an accepted upstream model ID.

With the production gateway enabled, the optional last-resort provider is
`riic-deepseek-official/deepseek-flash` at `https://api.deepseek.com`. Its
separate `AGENT_LLM_DEEPSEEK_OFFICIAL_{BASE_URL,MODEL,API_KEY}` settings and
versioned RMB rate row are described in `AGENT_GATEWAY_OPERATIONS.md`. It follows
the existing DeepSeek and GLM routes and keeps the existing 1.2 billing multiplier.

Store production secrets in the root-readable systemd EnvironmentFile
`/etc/arknights-infra-agent-private.env`, loaded by the web service's
`70-agent-private.conf` drop-in. This survives code releases without editing
sealed release snapshots. Restart the web service after changing configuration.
Never copy this file into the repository, build artifacts or client environment.

The authenticated status endpoint exposes only configured model IDs and labels.
Requests may select `deepseek` or `glm`; clients cannot supply an upstream URL,
credential or arbitrary model ID. The selector appears beside the page actions,
outside the message input. Selection is retained in the active conversation's
runtime; manual retry can use a newly selected model while preserving the
original question, attachments and persona.

Transient request-setup failures have at most two SDK retries. Timeout and
partial-stream failures are surfaced with localized retry guidance. Partially
received replies and tool execution are never automatically replayed. Keepalive
frames do not postpone the semantic-output timeout. Raw upstream errors and
connection URLs are excluded from public errors; production diagnostic logs use
the request ID and a stable error category, without conversation dumps.

Keep `AGENT_ACCESS_MODE=admin` and `BILLING_ACCESS_MODE=admin` during the beta.
Future public rollout remains controlled independently by these existing flags.

Validation: `npm run test:agent-models` and `npm run test:feature-access`.
For operator acceptance, exercise both models, interrupt/retry a response, and
switch pages during generation. Real billing settlement requires an Afdian
creator webhook notification URL as well as valid server API credentials.
