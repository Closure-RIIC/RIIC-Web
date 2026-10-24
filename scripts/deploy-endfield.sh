#!/usr/bin/env bash
set -euo pipefail
[[ "$DEPLOYMENT_ENV" == production || "$DEPLOYMENT_ENV" == development ]]
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$DEPLOY_TREE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9._-]+$ ]]
test "$DEPLOY_SSH_USER" = arkdeploy
archive="endfield-${DEPLOYMENT_ENV}-${DEPLOY_SHA}.tar.gz"
cd "$ENDFIELD_ARTIFACT_DIRECTORY"
test -f "$archive" && test ! -L "$archive"
test -f SHA256SUMS && test ! -L SHA256SUMS
# A single, expected filename prevents a checksum manifest from reading arbitrary files.
[[ "$(wc -l < SHA256SUMS)" -eq 1 ]]
read -r digest filename < SHA256SUMS
[[ "$digest" =~ ^[0-9a-f]{64}$ && "$filename" == "$archive" ]]
sha256sum --check --strict SHA256SUMS
gzip -t "$archive"
target="${DEPLOY_SSH_USER}@${DEPLOY_HOST}"
incoming="/srv/riic-endfield-deploy/${DEPLOYMENT_ENV}/${DEPLOY_SHA}.tar.gz"
options=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
scp "${options[@]}" -- "$archive" "$target:$incoming"
ssh "${options[@]}" "$target" \
  "sudo -n /usr/local/sbin/riic-endfield-deploy '$DEPLOYMENT_ENV' '$DEPLOY_SHA' '$DEPLOY_TREE_SHA' '$digest'"
