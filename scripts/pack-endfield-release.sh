#!/usr/bin/env bash
# Same deterministic packing algorithm on the CI runner and the upload server.
set -euo pipefail
[[ $# == 3 || $# == 5 ]]
release_root="$1"
archive="$2"
source_date_epoch="$3"
[[ "$source_date_epoch" =~ ^[1-9][0-9]*$ ]]
test -d "$release_root" && test ! -L "$release_root"
test -d "$(dirname -- "$archive")" && test ! -L "$(dirname -- "$archive")"
test ! -L "$archive"
test -z "$(find "$release_root" -mindepth 1 ! -type f ! -type d -print -quit)"
test -z "$(find "$release_root" -type f -links +1 -print -quit)"
staged_archive="$(mktemp "${archive}.XXXXXX")"
trap 'rm -f -- "$staged_archive"' EXIT HUP INT TERM
tar --sort=name --mtime="@$source_date_epoch" --owner=0 --group=0 --numeric-owner \
  --mode='u+rwX,go+rX,go-w' --format=gnu -cf - -C "$release_root" . \
  | gzip --best --no-name --rsyncable > "$staged_archive"
gzip -t "$staged_archive"
if [[ $# == 5 ]]; then
  [[ "$4" =~ ^[0-9a-f]{64}$ && "$5" =~ ^[1-9][0-9]*$ ]]
  test "$(sha256sum "$staged_archive" | cut -d ' ' -f 1)" = "$4"
  test "$(stat -c '%s' "$staged_archive")" = "$5"
fi
chmod 600 -- "$staged_archive"
mv -fT -- "$staged_archive" "$archive"
trap - EXIT HUP INT TERM
