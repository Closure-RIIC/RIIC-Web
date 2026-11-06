# Agent execution and settlement (#674)

Both automatic gateway routing and explicit direct model selection enter
`agent/agent-runner.ts`. Providers remain distinct; `accounted-runtime.ts`
records each model step and `tool-executor.ts` owns execution evidence and tool
fees. Neither transport has a second onFinish-only billing implementation.

## State ownership

| Record | Owner | Meaning |
| --- | --- | --- |
| agent_run.state | runner finalization | How the conversation ended |
| agent_run.delivered | answer boundary | Answer text was emitted by the server; **not** browser acknowledgement |
| agent_tool_execution.state | tool executor | How the tool invocation/wait ended |
| computation_state | solve computation callback | Actual underlying solver outcome, independently of the waiter |
| processing_state | result conversion/persistence callback | Whether a usable public result was retained |
| agent_model_call.status | accounting middleware | Measured, missing or unpriceable usage |
| agent_run.settlement | billing transaction | Reserved, settled or needs_review; never task success |

A tool call is unique within its run. Computation transitions from unknown/running
to succeeded/failed, and processing transitions from unknown to succeeded/failed.
A terminal wait is never rewritten by a late computation result. On stale process
recovery a lost waiter and an unfinished computation become unknown, rather than
claiming cancellation or solver failure. Existing records have no fabricated
execution history. Old interrupted direct usage is closed as awaiting review;
its existing debit is retained until there is evidence for an adjustment.

## Fee policy

* Verified model token fees are settled for completed, failed, cancelled and
  blocked conversations, regardless of answer emission. Unverified usage is
  retained for review; the verified portion is settled and unused holds released.
* Both transports reserve the same fixed tool fee. It is earned only when the
  solve tool returns a usable result that passes content checks. Cached successes
  use the same fee. Validation failure, solver failure, conversion/persistence
  failure, failed content checks, wait timeout and cancelled waiting earn no tool
  fee. There is no debit to refund for these new calls.
* A result arriving after a timeout/cancelled wait is retained without charging a
  late fee. Model fees already incurred still apply. Repeated finalization and
  tool completion are idempotent. Tool completion locks the run before changing
  its fee, using the same wallet/run lock order as settlement. Settlement closes
  any remaining tool fee reservations, so late callbacks cannot spend a released
  hold.
* Direct providers use the actual response model identity when reported, otherwise
  the configured model ID. Only exact versioned policy entries are priced. Old
  aliases or unknown models go to review; the service does not guess their price.

## Late results and access

A timed out tool returns `execution.id` and a result URL. The solver promise keeps
an attached completion handler that saves the public result. The existing shared
`runPlan` service remains responsible for computation and its own timeout/process
termination; this change introduces no second queue or worker.

`GET /api/agent/executions/:id` checks the Agent feature session and the owning
run's user ID. Other users receive 404. Successful responses are private/no-store.
The response exposes tool wait, computation and result processing separately.
The `query_schedule_execution` tool uses the same ownership check.

The conversation shows a separate status card for timed out/cancelled waits. It
polls at most five minutes, offers manual refresh, and renders a retained result
without editing the original assistant answer or submitting another solve.
Billing history retains its existing “settled” labels. Billing run detail exposes
execution evidence separately and excludes the stored result payload.

## Rollout and remaining boundaries

Apply migration `0029_agent_tool_execution` before deploying the application. The
migration and Drizzle snapshot create execution evidence only; they do not
backfill success for historical records. The old direct fee/refund functions
remain for historical records and their tests, but new chat requests do not use
them.

This is not durable solver resumption: the late-result handler runs in the web
process. If that process dies before saving the result, recovery exposes unknown
and does not start another computation. Durable task submission, queue recovery,
true solver cancellation and the task_id association still need the shared task
service work in #612. No claim of production gateway validation or browser
receipt acknowledgement is made.

## Validation

`npm run test:agent-models` includes actual solve-wrapper fault injection with a
mock solver and public-result converter, plus wait timeout/cancellation tests.
`npm run test:agent-billing-integration` includes real PostgreSQL assertions for
verified failed/undelivered billing, duplicate settlement, concurrent tool finish,
timeout followed by success, conversion failure, missing usage, cross-user reads,
legacy usage recovery and process interruption. No real model or solver is called.
