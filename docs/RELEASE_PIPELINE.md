# Release verification and deployment

`Post-merge release` keeps the existing static, unit, database, artifact, Chromium and browser-boundary checks. Production approval, artifact hashes, solver validation and the server's 300-second health observation remain required.

## Unreleased changes

For a push to `main` or `develop`, change classification compares the current commit with that environment's last successful deployment, rather than the immediately preceding push. This includes application changes from a failed release when the next PR only repairs tests. An unavailable deployment history, unknown baseline or non-ancestor baseline selects full verification and deployment.

The lookup examines the latest 20 deployments and trusts only a successful status for the matching environment and branch. It reads GitHub deployment metadata, not production credentials or database data.

## Deploy a commit that already passed verification

Use **Deploy previously verified release** when a successful `Post-merge release` run produced an artifact but did not deploy. Select `main` or `develop`, and provide:

- `verified_run_id`: the successful source workflow run ID.
- `expected_sha`: the full commit SHA selected by the dispatch, which must match the source run exactly.

Example (replace both placeholders):

```sh
gh workflow run deploy-verified.yml --ref develop \
  -f verified_run_id=RUN_ID -f expected_sha=FULL_COMMIT_SHA
```

The workflow validates the repository, source workflow/event, latest run attempt, successful quality/core jobs, exact branch and commit, and unexpired artifact provenance. Cross-environment and cross-commit reuse is rejected, even if two commits have the same Git tree. The normal environment approval and deployment workflow still run. It does not rebuild or repeat already successful tests.

Release artifacts from authorized runs with core checks are retained for seven days, including test-only changes. Missing/expired artifacts require the normal full release workflow. If the original run failed only during deployment, rerun its failed jobs instead; a failed source run cannot use the reuse workflow.

## Chromium scheduling

Ordinary Chromium tests use four shards with two workers each. Software-WebGL plush tests use two independent shards with one worker each. Both projects retain all tests, retries and assertions. The quality job waits for every shard. Separating projects avoids concentrating slower rendering tests in the final ordinary shard.

The baseline run `38933629378` took 322, 241, 228 and 706 seconds across its four combined shards. These are measurements of the previous layout, not a promise of the new runtime; confirm the improvement using the first CI run after landing.

## Transfer and safety limits

Deployment already uses checksum-based rsync deltas and compressed transfer. The baseline development deployment sent about 5.9 MB while the standalone tree was about 95 MB. This change retains that transfer mechanism and its final archive SHA-256 check. Network throughput and the mandatory production observation window still contribute to release time.

No production database connections are terminated, migration timeouts increased, or deployment approval rules weakened by these optimizations.
