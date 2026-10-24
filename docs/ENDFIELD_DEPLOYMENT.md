# Endfield deployment

The existing `Post-merge release` workflow builds an independent Endfield archive for the exact checked commit. Once the existing quality gate and GitHub Environment approval pass, `deploy.yml` deploys Arknights and then Endfield using the same non-root SSH account. An environment deployment is successful only after both applications finish verification. `Deploy previously verified release` downloads both archives from the verified source run without rebuilding.

| Branch | Environment | Endfield service | Release root | Loopback port | Account service |
| --- | --- | --- | --- | --- | --- |
| `main` | production | `riic-endfield` | `/srv/riic-endfield` | 4186 | existing production configuration |
| `develop` | development | `riic-endfield-dev` | `/srv/riic-endfield-dev` | 4286 | `http://127.0.0.1:4275` |

Production continues to use the existing administrator-only ingress at `dj.riic.autos`. Development listens only on loopback; this setup does not add public DNS, an ingress route, or change access policy. The runtime administrator gate remains active in both environments.

## One-time server setup

Review and copy `deploy/endfield-deploy.py`, `deploy/setup-endfield-deploy.sh`, and `deploy/endfield-dev.service` to a root-owned directory on the existing server, then run `bash setup-endfield-deploy.sh` as root. The script requires the existing production Endfield service, account configuration and `arkdeploy` account. It creates a separate development service and a narrowly scoped sudo installer. It does not switch the live production release, copy account secrets, or change nginx.

The root-owned installer accepts only an environment, commit SHA, tree SHA and archive SHA-256. Its targets, service users and ports are fixed. It copies the uploaded archive into protected staging, checks the checksum and provenance, rejects traversal, links, special files and environment files, then atomically switches `current` and restarts the corresponding service. Releases are immutable; a different archive cannot overwrite an already installed commit.

Verification checks the running systemd process's actual release directory and the expected anonymous 404 response from the administrator gate. Production receives twelve additional samples over sixty seconds; development receives three. A failure restores the previous release and restarts the service. This verifies the running version and access boundary; authenticated product acceptance is still performed by the user. Prior releases are retained for rollback.

## Validation

- `python deploy/endfield-deploy.test.py` checks safe extraction and release identity.
- `node scripts/test-endfield-access.mjs` validates the built runtime's administrator boundary with isolated account fixtures.
- For the sidebar regression, start Arknights on 5194 and Endfield on 5196 with `PLATFORM_API_ORIGIN=http://127.0.0.1:5197`, then run `node scripts/test-sidebar-alignment-e2e.mjs`. The script starts its own local account fixture on 5197 and checks both languages, signed-in/anonymous footer layouts, desktop collapse/expand and the mobile drawer. It never uses a real account.

No database migrations, dependency installation or builds run in the Endfield deployment job. Both archives have seven-day retention; an expired or missing Endfield archive requires a new full verification run.
