# Application release automation

## Release a PR from the command line

Run from this repository with Node.js 22.12+ and an authenticated GitHub CLI
(`gh auth status`). Use the maintainer account that is authorized to merge and,
when requested, approve the production environment. The command uses the existing
GitHub connection; it does not read, print or save tokens or SSH credentials.

```sh
# Read-only preview: PR, reviewed head, current branches and pending develop changes.
npm run release:pr -- 123

# Copy the exact head from the preview. This authorizes both environment releases.
npm run release:pr -- 123 --execute --head <40-character-sha> --approve-production
```

The first argument may also be a `https://github.com/Closure-RIIC/RIIC-Web/pull/123`
URL. Only one PR targeting `develop` is accepted. For a batch, first prepare one
integration PR containing the selected PR commits and any conflict resolutions,
then pass its number. The command does not execute contributor code locally.

Execution follows this sequence:

```text
reviewed PR -> required PR CI -> normal develop merge
  -> exact-commit post-merge checks and development deployment
  -> automatic release/* PR -> required main PR CI -> normal main merge
  -> production approval -> production deployment and health verification
```

The existing GitHub release workflow performs service health checks. The command
also checks each application's recorded successful deployment against the target
commit, using the same application release plan as CI. Unchanged applications may
retain an older successful deployment; any still-unpublished application changes
prevent success. It fetches Git objects for this comparison without changing the
current branch, index, working files or dependencies.

By default, other unpublished changes on `develop` stop execution before merging.
Review that additional scope before using `--include-develop`. The command requires
the existing `DEPLOY_AUTOMATION_ENABLED`, `PR_AUTOMATION_ENABLED` and
`RELEASE_PROMOTION_ENABLED` repository variables to be enabled. It never changes
those settings, branch protection, required checks, reviewers or environment rules.

Without `--approve-production`, execution stops at the production approval gate
and prints its GitHub run URL. Approve there, or repeat the exact command with the
flag using an authorized reviewer account. A missing PR review still needs to be
completed through GitHub. There is no administrator merge override.

Repeat the same command after interruption: it reconstructs progress from GitHub,
reuses existing merges, runs and the automatic release PR, and verifies current
branch heads. If a branch has advanced, it stops instead of including new changes.
If the PR itself changed, preview and review its new head before executing again.
Resolve conflicts or update a behind branch before retrying; these are never
force-resolved by the command. For failed CI, inspect the linked run and explicitly
retry its failed jobs after diagnosing the cause; the command never retries a
failure automatically. If GitHub did not start a push run, it dispatches the normal
workflow once with the exact expected commit and all mandatory checks. The optional
full WebKit suite follows the usual push setting; mandatory browser checks remain.

Each invocation has a 90-minute deadline. Use `--timeout-minutes 120` to change it
(maximum 240 minutes). Ctrl+C stops local monitoring; already-started GitHub jobs
continue. No saved credential or local release-state file is needed to resume.
Transient network/server failures on read-only GitHub requests are retried up to
three attempts. Writes are never blindly retried: rerun the command so it first
checks whether GitHub already applied the requested merge or approval.

Verification: `npm run test:release-pr` exercises the orchestration with an isolated
fake GitHub API, including retries, approval boundaries, stale heads, failed checks
and unshipped application changes. It never contacts GitHub or deploys a service.

## Release plan and deployment state

`scripts/app-release-plan.mjs` emits `check_apps`, `build_apps`, `deploy_apps` and per-application build/deploy booleans. It combines the current push diff with each application's changes since its own last successful deployment. It compares full trees with renames disabled, so deleting or moving files invalidates their former owner as well as their new owner. Missing history, an unavailable API or a non-ancestor baseline selects full verification and deployment for that application.

| Change | Deploy Arknights | Deploy Endfield |
| --- | --- | --- |
| `apps/arknights/**` implementation/assets | Yes | No |
| Arknights operator data or game-specific domain logic | Yes | No |
| `apps/endfield/**` or Endfield-only workspace packages | No | Yes |
| Shared shell, sidebar primitives, contracts | Yes | Yes |
| Endfield account/Skland backend hosted by Arknights | Yes | No; verify the Endfield consumer |
| Shared account validation/localization or platform proxy | Yes | Yes |
| Endfield deployment scripts/helper | No | Yes |
| Dependency lock update | Applications that consume changed locked dependencies | Applications that consume changed locked dependencies |
| Root build tooling, release workflow, unknown runtime paths | Yes | Yes |
| Documentation/tests/non-release CI alone | No | No |

Workspace consumers come from both revisions' manifests, including transitive dependencies. Lockfile comparisons follow each application's nested and hoisted dependencies plus shared root build tooling. An incomplete or unsupported lockfile falls back to both applications. `ENDFIELD_SHARED_LEAVES` identifies the account utilities and proxy actually imported from otherwise Arknights-hosted packages; a required dependency-contract test prevents new imports from silently expanding that boundary. Update the leaves and tests together when these dependencies change. Unknown workspace paths are treated conservatively.

Existing required static, unit, database and browser quality gates are retained. `check_apps` can therefore include both games even when only one deploys. Arknights browser verification may also require an Arknights build for an Endfield change. Neither building nor testing an application is permission to deploy it. Managed operator-data updates retain their browser fast path only if no earlier unshipped runtime change requires browser verification.

There are four independent baselines: each application in development and production. They are GitHub deployment records in the existing protected `development`/`production` environments, with tasks `deploy:arknights` and `deploy:endfield`, and versioned payloads identifying the application, branch, run and attempt. Only a verified successful health result advances that application's baseline. Automatic environment records have a different task and are ignored. GitHub may mark previous successful records inactive; this does not erase their successful health result.

The first rollout has no records in the new format, so both applications deploy once per environment to establish trustworthy baselines. It does not guess from the old shared environment status. API/history errors cannot suppress deployment.

Deployment jobs use `deploy-<application>-<branch>` concurrency, with cancellation disabled. The current branch SHA is checked after approval and again before switching services; an older queued job cannot overwrite a newer branch release. Retry of an already successful application at the same SHA is a no-op. The existing health observation and rollback mechanisms remain in force. If GitHub status recording fails after installation, the baseline remains conservative and the same immutable artifact can be retried.

## Independent retries

Use **Deploy previously verified release** with:

- `application`: `arknights` or `endfield`.
- `verified_run_id`: the original **Post-merge release** run.
- `expected_sha`: the exact current selected `main`/`develop` SHA.

The source run may have failed in deployment, but every required quality job must have succeeded in its latest attempt. The chosen artifact must be nonexpired and belong to that exact repository, branch, commit and run. A missing artifact, failed quality gate or advanced branch requires a new full verification run. A retry still passes through the existing production approval. The other application is untouched.

Incremental Endfield transfers use a disposable per-environment cache and verify an exact reconstruction of the complete CI artifact. See [Endfield deployment](ENDFIELD_DEPLOYMENT.md).

## Opt-in PR merging and promotion

`PR automation request` handles ordinary `pull_request` events without secrets, checkout or artifacts. Its completion triggers `Release PR automation` through `workflow_run` on the default branch. That workflow runs trusted code from `main` and reads current GitHub PR metadata; it never checks out, imports, builds or executes a PR head. A short-lived GitHub App token is restricted to this repository. Automatic actions do not approve reviews, bypass branch protection, change production reviewers or use `direct-main-release`.

1. A maintainer with write access applies the existing `automerge` label to a same-repository, non-draft PR targeting `develop`, or a `release/*` PR targeting `main`. The workflow checks who applied the latest label, rechecks the PR head and enables native auto-merge pinned to that head. Removing the label disables auto-merge set by the release App.
2. GitHub merges after the target branch's required gates pass: develop requires checks without review; main additionally requires an administrator's approval. An administrator may confirm their own main PR using the PR-review allowance, while required checks remain enforced. The App has no review bypass and its merge generates normal `push` workflows.
3. After **Post-merge release** succeeds on current `develop`, promotion validates its required quality jobs and independently confirms that neither application has pending deployment changes in development.
4. Promotion creates an immutable `release/automation/develop-<develop SHA>-<main SHA>` branch from main and merges the verified develop commit into it. It creates/reuses the corresponding PR to main, opts it into native auto-merge and closes superseded release PRs created by the same App. It never force-pushes reviewed code or modifies a human-owned release PR. Conflicts stop promotion for a maintainer to resolve.
5. Main's normal release policy and CI run. After merge, production approval is still required. The production plan selects applications using their production baselines, independently of development.

When a deployment initially failed but a one-application retry succeeded, completion of **Deploy previously verified release** resumes promotion automatically. It retrieves an exact-commit quality proof from the original post-merge runs and rechecks both development baselines. For manual recovery, run **Release PR automation** with mode `promote`, the original quality run ID and exact current develop SHA. Use mode `automerge` and `pr_number` to retry label handling after configuration is fixed. No successful development deployment means no promotion.

GitHub's native auto-merge settings and branch protection remain authoritative. The workflow does not invent a merge path when auto-merge is disabled.

## Administrator activation

The code can be reviewed and tested before these settings exist. Automation is off unless explicitly enabled.

1. Verify that both branches require the actual PR check `packages`; develop requires zero approvals, while main requires `Release branch only` and one administrator CODEOWNER approval. Only repository administrators receive PR-review bypass allowances, allowing an admin to confirm their own main PR without a second person. Keep CI enforcement for admins enabled and keep the App out of bypass lists. Post-merge `quality` is not a PR prerequisite. Resource publication uses these branch-specific gates; see [the Agent runbook](AUTO_MERGE_AGENT_RUNBOOK.md). Retain both environment protection policies.
2. Create/install a GitHub App on `Closure-RIIC` with **Contents: read/write**, **Pull requests: read/write**, **Issues: read/write** (labels), **Actions: read**, **Checks: read**, **Commit statuses: read**, and **Deployments: read**. It must not be a branch-protection bypass actor. Give the App only `Closure-RIIC/RIIC-Web`. A private personal App must be transferred to the organization or explicitly made available for cross-account installation before it can be installed there. Metadata read access is implicit.
3. Store its ID as repository variable `RELEASE_APP_ID` and private key as repository secret `RELEASE_APP_PRIVATE_KEY`. Do not put either a private key or a personal token in code, logs or PRs. Environment SSH credentials remain in the existing deployment environments.
4. Create the `automerge` repository label if absent. Merge this workflow into main before activation, since automation always executes the trusted main version.
5. Establish both application baselines through normal quality checks/deployment, then enable **Allow auto-merge** in repository settings and set `PR_AUTOMATION_ENABLED=1` for labeled PR handling. Set `RELEASE_PROMOTION_ENABLED=1` separately to enable automatic develop-to-main promotion after verified development deployment. Existing `DEPLOY_AUTOMATION_ENABLED=1` continues to control deployment itself.
6. Exercise a labeled Arknights-only PR and verify Endfield is absent from `deploy_apps`. Exercise an Endfield-only and a shared change, and inspect per-app success records and transfer summaries.

Disable promotion by clearing `RELEASE_PROMOTION_ENABLED`; disable future automated PR handling by clearing `PR_AUTOMATION_ENABLED`. Already enabled native auto-merges are independent GitHub state: remove their `automerge` labels while the handler is active, or disable them in GitHub before turning the handler off. Production approval is not automated.

GitHub App credentials are used so resulting PR and push events trigger normal CI. With `GITHUB_TOKEN`, push events do not start downstream workflows, and supported PR events may require approval to run. See [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) and [native auto-merge](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request).

## Local verification

```sh
node --test scripts/app-release-plan.test.mjs scripts/release-provenance.test.mjs scripts/release-automation.test.mjs scripts/ci-change-scope.test.mjs scripts/build-tooling.test.mjs
python3 deploy/endfield-deploy.test.py
python3 deploy/endfield-transfer.test.py
```

The transfer test requires Linux with rsync and uses isolated local SSH fixtures. These tests make no live GitHub mutations, SSH connections or service restarts. Deployment-scope, provenance and automation tests cover app ownership, dependency removal, lock changes, missing baselines, partial failures, stale jobs, exact artifact provenance, label authorization and promotion gating. Existing UI tests are neither added nor replaced by this change. Affected product UI: none.
