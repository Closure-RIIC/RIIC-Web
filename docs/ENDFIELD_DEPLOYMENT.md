# Endfield deployment

`Post-merge release` computes an application release plan before building. Once the existing quality gate and GitHub Environment approval pass, `deploy.yml` deploys only affected applications, each with its own concurrency lock and success record. An Arknights-only change does not upload or restart Endfield. `Deploy previously verified release` retries one selected application from a verified artifact without rebuilding. See [application release automation](APPLICATION_RELEASE_AUTOMATION.md) for classification, independent baselines, PR promotion and activation.

| Branch | Environment | Endfield service | Release root | Loopback port | Account service |
| --- | --- | --- | --- | --- | --- |
| `main` | production | `riic-endfield` | `/srv/riic-endfield` | 4186 | existing production configuration |
| `develop` | development | `riic-endfield-dev` | `/srv/riic-endfield-dev` | 4286 | `http://127.0.0.1:4275` |

Production continues to use the existing administrator-only ingress at `dj.riic.autos`. Development listens only on loopback; this setup does not add public DNS, an ingress route, or change access policy. The runtime administrator gate remains active in both environments.

## One-time server setup

Review and copy `deploy/endfield-deploy.py`, `deploy/setup-endfield-deploy.sh`, and `deploy/endfield-dev.service` to a root-owned directory on the existing server, then run `bash setup-endfield-deploy.sh` as root. The script requires the existing production Endfield service, account configuration and `arkdeploy` account. It creates a separate development service and a narrowly scoped sudo installer. It does not switch the live production release, copy account secrets, or change nginx.

The root-owned installer accepts only an environment, commit SHA, tree SHA and archive SHA-256. Its targets, service users and ports are fixed. It copies the uploaded archive into protected staging, checks the checksum and provenance, rejects traversal, links, special files and environment files, then atomically switches `current` and restarts the corresponding service. Releases are immutable; a different archive cannot overwrite an already installed commit.

The runner first checks and safely extracts the complete CI artifact, then uses checksum-based rsync to send changed file blocks to `/srv/riic-endfield-deploy/<environment>/tree-cache`. This disposable directory is separate from live and rollback releases. The transfer rejects links and special files, synchronizes deletions, and uses no hard links or inplace writes. The first transfer or a missing cache sends the complete tree. An interrupted transfer can be retried safely.

`scripts/pack-endfield-release.sh` uses identical deterministic tar/gzip options on the runner and server. The reconstructed archive must have exactly the same byte count and SHA-256 as the CI artifact before installation. Failed transfer, identity validation or packing leaves the current service unchanged. The Actions summary reports actual rsync bytes sent/received, matched/literal data and elapsed time. CI still builds a complete artifact; incremental updating refers to transport, not partially built application code.

Existing servers set up with `setup-endfield-deploy.sh` need no installer change for incremental transfer. Both the runner and upload server need rsync, GNU tar, gzip with `--rsyncable`, and Python 3.12 or newer. Existing SSH host verification and the non-root upload account remain required.

Verification checks the running systemd process's actual release directory and the expected anonymous 404 response from the administrator gate. Production receives twelve additional samples over sixty seconds; development receives three. A failure restores the previous release and restarts the service. This verifies the running version and access boundary; authenticated product acceptance is still performed by the user. Prior releases are retained for rollback.

## Validation

- `python deploy/endfield-deploy.test.py` checks safe extraction and release identity.
- `python3 deploy/endfield-transfer.test.py` on Linux runs the actual transfer script against isolated local SSH fixtures and real rsync. It covers incremental transfer, deletions, interrupted/restarted transfers, missing cache, checksum mismatch, stale commits, and rejected cache links. It never connects to a server or switches a real service.
- `node scripts/test-endfield-access.mjs` validates the built runtime's administrator boundary with isolated account fixtures.
- For the sidebar regression, start Arknights on 5194 and Endfield on 5196 with `PLATFORM_API_ORIGIN=http://127.0.0.1:5197`, then run `node scripts/test-sidebar-alignment-e2e.mjs`. The script starts its own local account fixture on 5197 and checks both languages, signed-in/anonymous footer layouts, desktop collapse/expand and the mobile drawer. It never uses a real account.

No database migrations, dependency installation or builds run in the Endfield deployment job. Both archives have seven-day retention; an expired or missing Endfield archive requires a new full verification run.
