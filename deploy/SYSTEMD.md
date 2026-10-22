# systemd runtime settings

## Persistent Worker diagnostics

The Worker must explicitly set an absolute `BETA_STORAGE_DIR` equal to its website's persistent storage directory. Services do not inherit each other's environment. Without this setting, a standalone working directory resolves the fallback under the immutable release, which `ProtectSystem=strict` cannot write. Temporary solver output is not a substitute for persistent diagnostic records.

Install the matching drop-in before deploying a release, then let deployment restart the Worker:

```bash
sudo install -D -o root -g root -m 0644 deploy/plan-worker-storage-dev.conf /etc/systemd/system/arknights-infra-dev-worker.service.d/50-persistent-storage.conf
sudo install -D -o root -g root -m 0644 deploy/plan-worker-storage.conf /etc/systemd/system/arknights-infra-worker.service.d/50-persistent-storage.conf
sudo systemctl daemon-reload
```

Adapt service names and paths together for other installations. Keep `ReadWritePaths` restricted to that environment's persistent directory and keep it owned by the non-root application user. Do not loosen `ProtectSystem`. Before warming solver lanes, publishing readiness, or claiming tasks, the Worker validates storage boundaries and writes, syncs, and removes a private probe file. Missing or unwritable storage therefore blocks the new release's readiness instead of silently losing failure attachments. Existing lost temporary files cannot be recovered by this configuration change.

## Diagnostic logs and non-destructive journal archives

The admin diagnostics panel groups events without removing individual records. New API and Worker diagnostics are appended to `BETA_STORAGE_DIR/diagnostic-logs/YYYY-MM-DD.ndjson` (private directory, mode 0700; files 0600). Records include sanitized exception chains, validation fields, request IDs and release identity. No credentials, request bodies or full BOX snapshots are copied. This directory is **not** part of the 30-day business/private-record cleanup. The reader is bounded to 16 MiB and explicitly labels incomplete results. A missing storage configuration is shown as unavailable, never as a healthy zero-error result.

Keep systemd journals as the original source, including historical events and framework errors. Install the incremental archive timer once as root:

The sample service uses Node.js 22 at `/usr/local/bin/node`; adjust that executable to the host's verified Node installation if necessary.

```bash
sudo install -D -o root -g root -m 0644 scripts/archive-journals.mjs /usr/local/lib/riic/archive-journals.mjs
sudo install -D -o root -g root -m 0644 deploy/riic-log-archive.service /etc/systemd/system/riic-log-archive.service
sudo install -D -o root -g root -m 0644 deploy/riic-log-archive.timer /etc/systemd/system/riic-log-archive.timer
sudo systemctl daemon-reload
sudo systemctl start riic-log-archive.service
sudo systemctl enable --now riic-log-archive.timer
```

The first run copies all currently available journals for both environments' web and Worker units; subsequent runs copy incremental periods with a one-second overlap. Gzip segments are immutable, private, root-owned files in `/var/lib/riic-log-archive`. Checkpoints advance only after gzip output and the journal producer both succeed and the output is synced. Failed partial files remain for investigation. The archiver never calls `vacuum`, rotates source journals, prunes archives, or deletes database records. Inspect health with `systemctl status riic-log-archive.timer`, `journalctl -u riic-log-archive.service`, and `df -h /var/lib/riic-log-archive`. Less than 2 GiB free emits `log_archive_low_disk`; provision more storage or an explicitly approved archive destination, **not automatic deletion**. Manual runs must use the service's `flock` command to avoid concurrent checkpoints.

This preserves logs that still exist when archiving starts; it cannot restore already expired historical logs. Automatic application deployment does not install root-owned service units or overwrite this archive. User-initiated data deletion and the existing TTL of private BOX data, telemetry event rows and reproduction attachments are unchanged. Do not conflate retaining operational logs with retaining users' private data forever.

## Optional pinned v2 solver fallback

The primary solver stays unchanged. To enable one v2 attempt after a primary computation, transport, or output-contract failure, configure all four variables on both the website and Worker services:

```ini
[Service]
Environment=INFRA_FALLBACK_CLI_PATH=/opt/riic-solvers/v2/<immutable-release>/infra-cli
Environment=INFRA_FALLBACK_DATA_DIR=/opt/riic-solvers/v2/<immutable-release>/data
Environment=INFRA_FALLBACK_CLI_SHA256=<64-lowercase-hex-sha256>
Environment=INFRA_FALLBACK_DATA_SHA256=<64-lowercase-hex-sha256>
```

Use a reviewed, fixed source commit from ArknightsInfraCalc-v2 and its matching data snapshot, never a mutable `latest` download at request time. Install the executable and data outside website release directories, owned by root and readable/executable but not writable by the service user. Record both the executable and complete bundle checksums. Neither the primary executable, active pointer, approved-primary hash nor its data directory is replaced. Do not package private source, inputs or logs in the public website repository.

The Worker verifies the fallback file's SHA-256 and each lane's ping/schema/identity before reporting its first heartbeat. The complete data tree is hashed at startup and before each run using `hashSolverDataDirectory` from `packages/platform-server/src/solver-fallback.ts`: recursively sort names, then hash the UTF-8 concatenation of `JSON.stringify([relativePosixPath, fileSha256]) + "\n"` for each file. Symlinks and special files are rejected. Partial or invalid configuration fails closed. When all four variables are absent, the existing primary-only path is unchanged. Remove only these four configuration entries and restart through the normal deployment workflow to disable fallback; leave installed binaries, data and logs intact.

When enabled, each lane serializes the entire primary/fallback pair. The primary receives 75% of the existing solver timeout budget; v2 receives only the remaining time, with hard deadlines stopping the active process. There is at most one fallback, with the same effective input and rotation/Fiammetta options. Website input admission, authentication, rate limits, database errors and artifact housekeeping are outside this retry boundary. A v2 error or invalid/partial response remains a failure; fallback is an availability policy, not a guarantee that every input has a feasible schedule.

Primary failures are preserved before fallback in private `primary-attempt.json`; attempted fallback responses are kept in `fallback-attempt.json`. These reproduction files retain the existing private-data TTL. Sanitized primary reasons, both solver hashes and fallback outcomes are retained in the separate append-only diagnostic logs and journal archives. Admin diagnostic event counts therefore include recovered primary failures and must not be read as final task failure rates. The final run records the actual winning solver identity and combined reported solver time when both attempts supply it. Recovered v2 results release, rather than populate, the primary solver's cache lease.

## Graceful website shutdown behavior

Next.js owns `SIGINT` and `SIGTERM` so that it can stop accepting new requests and drain in-flight requests before exiting. Its standalone server exits with status `130` or `143` after that graceful shutdown.

Install [`node-graceful-exit.conf`](./node-graceful-exit.conf) as a drop-in for every website service, then reload systemd:

```bash
sudo install -D -o root -g root -m 0644 \
  deploy/node-graceful-exit.conf \
  /etc/systemd/system/<website-service>.service.d/node-graceful-exit.conf
sudo systemctl daemon-reload
```

The drop-in only classifies Next.js's documented signal exit statuses as successful. It does not change restart policy, stop timeout, or service state. Do not add application-level signal handlers that terminate the shared solver before Next.js has drained in-flight HTTP requests.

The production task queue runs `worker/plan-worker.cjs` in a separate systemd service. One central dispatcher feeds four persistent `infra-cli serve` solver lanes with two bounded task slots per lane. Each solver client still serializes `plan.compute`, while the sibling slot can prepare the next request or finish cache and database work so the solver is not left idle between tasks. At most eight tasks are claimed by this Worker process, while at most four solver computations run concurrently. PostgreSQL `NOTIFY` wakes the dispatcher immediately; a latched wake signal closes the empty-claim-to-wait race, failed LISTEN connections reconnect automatically, and a two-second timer remains as a low-frequency safety poll throughout. Full diagnostic files are expanded once from durable run envelopes by two background finalizers; transient database confirmation failures retry only that confirmation, continue on a slow recovery interval after the initial backoff is exhausted, and use durable expanded/finalized/failed markers for phase-aware restart recovery. Malformed envelopes are quarantined immediately, while a run row still missing after ten minutes is treated as a crash orphan; retrying stops at the 30-day private-record retention boundary. Finalizers and the bounded background timing-update set receive a 30-second shutdown drain budget. A failure or restart in one solver lane cannot attach its protocol output to another lane's active request. Before publishing its first heartbeat, the Worker starts and pings all four lane clients, so deployment readiness fails closed if the host cannot start the configured solver capacity. Its working directory must be the active release's `.output` directory so `the runtime environment loader` loads the same sealed `.env.local` and `.env.production.local` snapshots as the website. The deployment helper injects `APP_RELEASE_SHA` and `PLAN_TASK_QUEUE_ENABLED=1`, restarts the website and worker together, and accepts the release only after `/api/health` reports a fresh heartbeat from that exact SHA and remains healthy throughout the post-activation observation window.

Keep the worker unit root-owned, run it as the same non-root application user, and grant writes only to the environment's `/var/lib/arknights-infra*` persistent directory. Install both environment-specific units and reload systemd before installing deployment helper contract v6. Contract v6 keeps the previous release available during a five-minute production observation window and rolls back if internal or public health fails. Do not start the worker against an older release that has no `worker/plan-worker.cjs`; the first successful v5 deployment enables it.
