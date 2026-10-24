# Public repository administration checklist

This checklist contains GitHub repository settings only. It deliberately excludes credentials, hostnames, private helper source, server topology, and operational commands.

The public repository is owned by `Closure-RIIC`. Use a repository administrator for repository settings and an organization owner or authorized App manager for App registration and installation. Verify current permissions instead of inferring them from the former personal ownership.

## Organization transfer

- [ ] Confirm the transferred repository is `Closure-RIIC/RIIC-Web` and retains its existing commits, issues, and pull requests.
- [ ] Update Git remotes, workflow repository guards, release provenance checks, and public repository links to the organization path.
- [ ] Verify collaborators and CODEOWNERS still have the required permissions. Individual author names and copyright notices remain unchanged.
- [ ] Install the release App on `Closure-RIIC`, scoped only to `RIIC-Web`; verify its ID, private-key Secret, and requested permissions.
- [ ] Keep `PR_AUTOMATION_ENABLED=0` and `RELEASE_PROMOTION_ENABLED=0` until the workflows, PR gates, and deployment baselines are ready. See [the Agent runbook](AUTO_MERGE_AGENT_RUNBOOK.md).

## Branch and Actions policy

- [ ] Set `main` as the default branch.
- [ ] Protect both `main` and `develop`: require the `packages` PR check from `Dual application packages`, at least one approval, resolved conversations, and block force pushes and deletion. Do not require post-merge `quality` as a PR status.
- [ ] On `main` only, require the lightweight `Release branch only` status so ordinary feature PRs cannot bypass the release lane.
- [ ] Require CODEOWNER review for the sensitive paths listed in `.github/CODEOWNERS`.
- [ ] Do not routinely bypass protection as repository owner.
- [ ] Keep the default `GITHUB_TOKEN` permission read-only.
- [ ] Allow GitHub Actions to create pull requests so the narrowly scoped asset-sync workflow can update `develop`.
- [ ] Enable private vulnerability reporting and the relevant GitHub security checks.

Ordinary pull requests run `Dual application packages`; they do not run the post-merge quality workflow. A separate lightweight policy rejects every pull request to `main` unless its head is a `release/**` branch in this same repository. By default, that head commit must contain `develop`; a maintainer-applied `direct-main-release` label may explicitly waive only the ancestry check. External and ordinary feature PRs target `develop`. Every push produced by a merge into `develop` or `main` runs the full parallel quality gate before deployment.

Require checks only after observing their actual check-run names on the relevant PR base branch. The updated asset-sync flow uses a repository-scoped App token and native auto-merge to wait for checks and independent review. Existing pending resource PRs retain their commits; publication does not force-push them. After an actual resource merge to main, a validated closed-PR event creates the develop parity PR, which also waits for the same gates. Verify that this version is on main and generated PR workflows run before enabling automation; do not add a protection bypass for the bot.

## Deployment configuration

Create repository variable:

- `DEPLOY_AUTOMATION_ENABLED=0`

Keep it at exactly `0` throughout initialization and preflight.

Create `development` and `production` Environments. Enter these secrets separately in each Environment:

- `DEPLOY_HOST`
- `DEPLOY_SSH_USER`
- `DEPLOY_SSH_PRIVATE_KEY`
- `DEPLOY_SSH_KNOWN_HOSTS`
- `DEPLOY_PUBLIC_HEALTH_URL`

Enter these non-sensitive variables separately in each Environment:

- `DEPLOY_APP_ROOT`
- `DEPLOY_SERVICE`
- `DEPLOY_RUN_USER`
- `DEPLOY_INTERNAL_PORT`
- `DEPLOY_DEBUG_TOOLS_ENABLED`
- `DEPLOY_RATE_LIMIT_ENABLED`
- `DEPLOY_APPROVED_SOLVER_SHA256` (development only)

Do not copy values out of old GitHub secrets; re-enter them from the owner-controlled secure store. In particular, the development health URL is an Environment secret, never a repository variable or committed value.

Restrict `development` to `develop`. Restrict `production` to `main` and retain its authorized human reviewers. Confirm reviewer permissions after the organization transfer.

## Enablement checkpoints

- [ ] Re-enable Actions only after branch protection and both Environments are configured.
- [ ] Manually run full CI on `main` and `develop`; the deploy job must be skipped while the repository variable is `0`.
- [ ] Run `Deployment preflight` in `baseline` mode for a read-only report of the installed deploy helper contract and available disk space; root-only solver details remain hidden in this mode.
- [ ] After private server maintenance, rerun preflight in `cutover-ready` mode.

Production retains the server's current solver. Its deployment and cutover-ready preflight read `shared/bin/infra-cli.sha256` from the server; no GitHub production solver approval variable is required. The root-owned deployment helper must verify the solver and sidecar ownership, their matching SHA-256, the current release and runtime configuration, and the Worker's `ping` fingerprint before deployment proceeds. The resolved digest is pinned for that deployment, so a concurrent solver change fails validation instead of silently changing the release.

Development still requires `DEPLOY_APPROVED_SOLVER_SHA256` to match its independently approved shared solver. Prepare private server assets from the owner-controlled release record; never derive and trust a digest solely from a runtime-user-writable file. Neither workflow installs a new solver or weakens the server's integrity checks.
- [ ] Disable automatic deployment in the old private repository before setting the public repository variable to `1`.
- [ ] Change `deploy/PUBLIC_DEPLOYMENT_SOURCE` in a PR to `public-automation-v1` and merge it to `develop`. This path is intentionally classified as deploy-required.
- [ ] Complete development acceptance, then create a same-repository `release/develop-to-main-YYYYMMDD` PR.
- [ ] After merging the reviewed release PR, approve the production Environment only when the post-merge `quality` job has passed.

Do not delete old releases, helper binaries, or Git-cache backups until both environments have been stable for at least seven days.
