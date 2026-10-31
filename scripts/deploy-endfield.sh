#!/usr/bin/env bash
set -euo pipefail
[[ "$DEPLOYMENT_ENV" == production || "$DEPLOYMENT_ENV" == development ]]
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$DEPLOY_TREE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$SOURCE_DATE_EPOCH" =~ ^[1-9][0-9]*$ ]]
[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9._-]+$ ]]
test "$DEPLOY_SSH_USER" = arkdeploy
archive="endfield-${DEPLOYMENT_ENV}-${DEPLOY_SHA}.tar.gz"
repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test -d "$ENDFIELD_ARTIFACT_DIRECTORY" && test ! -L "$ENDFIELD_ARTIFACT_DIRECTORY"
local_archive="$ENDFIELD_ARTIFACT_DIRECTORY/$archive"
manifest="$ENDFIELD_ARTIFACT_DIRECTORY/SHA256SUMS"
test -f "$local_archive" && test ! -L "$local_archive"
test -f "$manifest" && test ! -L "$manifest"
# A single, expected filename prevents a checksum manifest from reading arbitrary files.
[[ "$(wc -l < "$manifest")" -eq 1 ]]
read -r digest filename < "$manifest"
[[ "$digest" =~ ^[0-9a-f]{64}$ && "$filename" == "$archive" ]]
(cd "$ENDFIELD_ARTIFACT_DIRECTORY" && sha256sum --check --strict SHA256SUMS)
gzip -t "$local_archive"
archive_bytes="$(stat -c '%s' "$local_archive")"
release_tree="$(mktemp -d "$RUNNER_TEMP/endfield-transfer.XXXXXX")"
control_directory=""
control_socket=""
target="${DEPLOY_SSH_USER}@${DEPLOY_HOST}"
cleanup() {
  if [[ -n "$control_socket" ]]; then
    ssh -S "$control_socket" -O exit "$target" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$release_tree"
  if [[ -n "$control_directory" ]]; then rm -rf -- "$control_directory"; fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
# Reuse the installer's archive policy before any local extraction or transfer.
python3 -B - "$repository_root/deploy/endfield-deploy.py" "$local_archive" "$release_tree" "$DEPLOY_SHA" "$DEPLOY_TREE_SHA" <<'PY'
import importlib.util
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location("endfield_installer", sys.argv[1])
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
installer.extract_release(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], sys.argv[5])
PY
incoming="/srv/riic-endfield-deploy/${DEPLOYMENT_ENV}/${DEPLOY_SHA}.tar.gz"
cache="/srv/riic-endfield-deploy/${DEPLOYMENT_ENV}/tree-cache"
options=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
command -v rsync >/dev/null
control_directory="$(mktemp -d /tmp/riic-endfield-ssh.XXXXXX)"
control_socket="$control_directory/control"
# Only connection establishment is retried. All remote operations share this
# authenticated transport; a lost transport must not replay a deployment.
for attempt in 1 2 3; do
  if timeout --kill-after=5s 30s ssh "${options[@]}" \
    -o ControlMaster=yes -o "ControlPath=$control_socket" -o ControlPersist=no -fN "$target"; then
    break
  fi
  if [[ "$attempt" -eq 3 ]]; then exit 255; fi
  sleep "$attempt"
done
# Prevent ssh from silently opening a fresh connection if the master is lost.
options+=(-S "$control_socket" -o ControlMaster=no -o ProxyCommand=false)
timeout --kill-after=5s 30s ssh "${options[@]}" "$target" bash -s -- "$DEPLOYMENT_ENV" <<'REMOTE'
set -euo pipefail
[[ "$1" == production || "$1" == development ]]
command -v rsync >/dev/null
parent="/srv/riic-endfield-deploy/$1"
cache="$parent/tree-cache"
test -d "$parent" && test ! -L "$parent"
test "$(stat -c '%U:%a' "$parent")" = "$(id -un):700"
test ! -L "$cache"
if [[ -e "$cache" ]]; then test -d "$cache"; else mkdir -m 700 -- "$cache"; fi
test "$(stat -c '%U' "$cache")" = "$(id -un)"
chmod 700 -- "$cache"
test -z "$(find "$cache" -mindepth 1 ! -type f ! -type d -print -quit)"
test -z "$(find "$cache" -type f -links +1 -print -quit)"
REMOTE
started="$SECONDS"
transfer_log="$RUNNER_TEMP/endfield-transfer-stats.log"
# The disposable cache is separate from releases/current. No hard links or
# inplace writes: interruption cannot change any running or rollback release.
printf -v rsync_shell '%q ' ssh "${options[@]}"
timeout --kill-after=10s 3600s rsync --recursive --times --perms --checksum --compress \
  --delete-delay --partial --no-owner --no-group --stats \
  -e "$rsync_shell" -- "$release_tree/" "$target:$cache/" | tee "$transfer_log"
timeout --kill-after=10s 900s ssh "${options[@]}" "$target" \
  "bash -s -- '$cache' '$incoming' '$SOURCE_DATE_EPOCH' '$digest' '$archive_bytes'" \
  < "$repository_root/scripts/pack-endfield-release.sh"
{
  printf '### Endfield incremental transfer\n\n'
  printf 'Archive bytes: %s; transfer and verification: %ss; SHA-256: `%s`.\n\n' "$archive_bytes" "$((SECONDS - started))" "$digest"
  sed -n '/^Literal data:/p; /^Matched data:/p; /^Total bytes sent:/p; /^Total bytes received:/p' "$transfer_log"
} >> "$GITHUB_STEP_SUMMARY"
# Branch may have advanced during the transfer; never switch an obsolete build.
node "$repository_root/scripts/release-provenance.mjs" assert-current
ssh "${options[@]}" "$target" \
  "sudo -n /usr/local/sbin/riic-endfield-deploy '$DEPLOYMENT_ENV' '$DEPLOY_SHA' '$DEPLOY_TREE_SHA' '$digest'"
