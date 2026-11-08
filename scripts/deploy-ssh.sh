#!/usr/bin/env bash
# One authenticated transport for Arknights preflight, transfer and activation.
set -euo pipefail
[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9._-]+$ ]]
[[ "$DEPLOY_SSH_USER" =~ ^[A-Za-z0-9_-]+$ ]]
test "$DEPLOY_SSH_USER" != root
target="${DEPLOY_SSH_USER}@${DEPLOY_HOST}"
case "${1:-}" in
  open)
    control_directory="$(mktemp -d /tmp/riic-arknights-ssh.XXXXXX)"
    control_socket="$control_directory/control"
    # Publish before connecting so the always() cleanup also handles failures.
    printf 'DEPLOY_SSH_CONTROL_SOCKET=%s\n' "$control_socket" >> "$GITHUB_ENV"
    for attempt in 1 2 3; do
      if timeout --kill-after=5s 30s ssh -o BatchMode=yes -o StrictHostKeyChecking=yes \
        -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
        -o ControlMaster=yes -o "ControlPath=$control_socket" -o ControlPersist=no -fN "$target"; then
        exit 0
      fi
      if [[ "$attempt" -eq 3 ]]; then exit 255; fi
      sleep "$attempt"
    done
    ;;
  close)
    [[ "${DEPLOY_SSH_CONTROL_SOCKET:-}" =~ ^/tmp/riic-arknights-ssh\.[A-Za-z0-9]{6}/control$ ]]
    control_directory="${DEPLOY_SSH_CONTROL_SOCKET%/control}"
    test -d "$control_directory" && test ! -L "$control_directory"
    test "$(stat -c '%U:%a' "$control_directory")" = "$(id -un):700"
    timeout --kill-after=5s 10s ssh -S "$DEPLOY_SSH_CONTROL_SOCKET" -O exit "$target" || true
    rm -f -- "$DEPLOY_SSH_CONTROL_SOCKET"
    rmdir -- "$control_directory"
    ;;
  *) echo 'Usage: deploy-ssh.sh open|close' >&2; exit 2 ;;
esac
