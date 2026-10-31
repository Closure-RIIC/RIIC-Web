# Release verification and deployment

日常操作统一使用 [命令行 PR 双环境发布手册](PR_RELEASE_GUIDE.md)。下面的独立产物重试属于高级恢复路径，不能代替正常发布的检查、审核和审批。

`Post-merge release` keeps the existing static, unit, database, artifact, Chromium and browser-boundary checks. Production approval, artifact hashes, solver validation and the server's 300-second health observation remain required.

## Unreleased changes

For a push to `main` or `develop`, change classification compares the current commit with that environment's last successful deployment, rather than the immediately preceding push. This includes application changes from a failed release when the next PR only repairs tests. An unavailable deployment history, unknown baseline or non-ancestor baseline selects full verification and deployment.

The lookup reads at most 20 pages of 100 deployments for the selected application and environment. It validates the application task, branch payload, and latest non-inactive status, trusting only success. It reads GitHub deployment metadata, not production credentials or database data.

## Deploy a commit that already passed verification

Use **Deploy previously verified release** to retry one application from an exact-commit `Post-merge release` run whose required quality checks passed. Select `main` or `develop`, and provide:

- `application`: `arknights` or `endfield`.
- `verified_run_id`: the source workflow run ID with successful required quality checks.
- `expected_sha`: the full commit SHA selected by the dispatch, which must match the source run exactly.

Example (replace both placeholders and select the intended application):

```sh
gh workflow run deploy-verified.yml --ref develop \
  --repo Closure-RIIC/RIIC-Web -f application=endfield \
  -f verified_run_id=RUN_ID -f expected_sha=FULL_COMMIT_SHA
```

The workflow validates the repository, source workflow/event, latest run attempt, successful quality/core jobs, exact branch and commit, and unexpired artifact provenance. Cross-environment and cross-commit reuse is rejected, even if two commits have the same Git tree. The normal environment approval and deployment workflow still run. It does not rebuild or repeat already successful tests.

Release artifacts from authorized runs with core checks are retained for seven days, including test-only changes. Missing/expired artifacts require the normal full release workflow. For a deployment-only failure in the ordinary `release:pr` flow, diagnose and rerun that run's failed jobs so its overall result can complete successfully. Independent reuse also accepts a source run whose conclusion is failure when every required quality job succeeded; it never accepts failed quality checks. A successful independent retry does not change the original run's failed conclusion, and `release:pr` still checks that original post-merge run. Do not keep restarting it expecting the failed conclusion to disappear; reconcile the exact quality proof and application deployment records before continuing manually.

## Chromium scheduling

Ordinary Chromium tests use four shards with two workers each. Software-WebGL plush tests use two independent shards with one worker each. Both projects retain all tests, retries and assertions. The quality job waits for every shard. Separating projects avoids concentrating slower rendering tests in the final ordinary shard.

The baseline run `38933629378` took 322, 241, 228 and 706 seconds across its four combined shards. These are measurements of the previous layout, not a promise of the new runtime; confirm the improvement using the first CI run after landing.

## Transfer and safety limits

Deployment already uses checksum-based rsync deltas and compressed transfer. The baseline development deployment sent about 5.9 MB while the standalone tree was about 95 MB. This change retains that transfer mechanism and its final archive SHA-256 check. Network throughput and the mandatory production observation window still contribute to release time.

No production database connections are terminated, migration timeouts increased, or deployment approval rules weakened by these optimizations.
