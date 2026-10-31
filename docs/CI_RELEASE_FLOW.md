# CI and release flow

日常操作见 [命令行 PR 双环境发布手册](PR_RELEASE_GUIDE.md)。This page describes verification stages; current workflows and remote protection rules remain authoritative.

The public repository deliberately separates code review from release verification.

| Event | Automated work | Deployment |
| --- | --- | --- |
| Pull request to `develop` | `packages` verifies both application packages and required contracts | Never |
| Pull request to `main` | `packages`, release-branch / `develop` ancestry policy, and required CODEOWNER review | Never |
| Push/merge to `develop` | Changed-path classification, then parallel static, database, build, four-shard Chromium, and browser-boundary checks | Development after `quality` passes |
| Push/merge to `main` | The same post-merge gate | Production after `quality` and Environment approval |
| Nightly/manual compatibility run | Full WebKit suite | Never for the scheduled event |

The release build is immutable within one workflow run. `Build release once` creates the solver-free standalone archive. Deployment artifacts are retained for seven days; the separate browser-verification copy is retained for one day. The deploy job downloads and validates the exact deployment artifact; it must not install dependencies or rebuild the application.

For runtime changes, the latency target from branch push to a development deployment, or to the start of a production health observation, is 6–7 minutes. Production then deliberately observes 20 successful health samples over 300 seconds in the root-owned deployment helper. That observation occurs after the new release is already serving traffic, so it is reported separately from time-to-online. Human Environment approval wait time is also excluded from automation latency.

When no earlier application changes remain unpublished, documentation-only pushes skip build, browser checks, and deployment. Test/tooling-only pushes run relevant checks without an application deployment unless the release plan requires one. Scope also uses each application's successful deployment baseline, so previously unpublished runtime changes still require checks and deployment.
