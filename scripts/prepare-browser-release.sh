#!/usr/bin/env bash
set -euo pipefail

download_root="$1"
release_root="$2"
expected_sha="$3"
expected_tree="$4"
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ && "$expected_tree" =~ ^[0-9a-f]{40}$ ]]
[[ -d "$download_root" && ! -L "$download_root" && ! -e "$release_root" ]]
shopt -s nullglob
archives=("$download_root"/arknights-infra-*-${expected_sha}.tar.gz)
[[ ${#archives[@]} == 1 && -f "$download_root/SHA256SUMS" ]]
(cd "$download_root" && sha256sum --check --strict SHA256SUMS)
gzip -t "${archives[0]}"
while IFS= read -r entry; do
  case "$entry" in
    /*|../*|*/../*|*/..) echo "Unsafe browser release archive path" >&2; exit 1 ;;
  esac
done < <(tar -tzf "${archives[0]}")
mkdir -p "$(dirname "$release_root")"
mkdir "$release_root"
tar --extract --gzip --file "${archives[0]}" --directory "$release_root" --no-same-owner --no-same-permissions
test -z "$(find "$release_root" -mindepth 1 ! -type f ! -type d -print -quit)"
node --input-type=module - "$release_root" "$expected_sha" "$expected_tree" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const [root, sha, tree] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(`${root}/.release-artifact.json`, 'utf8'));
assert.equal(manifest.formatVersion, 1);
assert.equal(manifest.kind, 'riic-web-tanstack-start');
assert.equal(manifest.releaseSha, sha);
assert.equal(manifest.releaseTreeSha, tree);
assert.equal(readFileSync(`${root}/.output/BUILD_ID`, 'utf8').trim(), sha);
console.log(`Browser tests use the verified release ${sha}`);
NODE
