#!/usr/bin/env bash
# Run as root from the reviewed deploy/ directory. Does not switch a live release.
set -euo pipefail
test "$(id -u)" = 0
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
id arkdeploy >/dev/null
id riic-endfield >/dev/null
test -f /etc/riic/endfield.env
systemctl cat riic-endfield.service >/dev/null
if ! id riic-endfield-dev >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /srv/riic-endfield-dev --shell /usr/sbin/nologin riic-endfield-dev
fi
install -d -o root -g root -m 755 /srv/riic-endfield-dev /srv/riic-endfield-dev/releases /srv/riic-endfield-deploy
for environment in production development; do
  install -d -o arkdeploy -g arkdeploy -m 700 "/srv/riic-endfield-deploy/$environment"
done
install -o root -g root -m 755 "$source_dir/endfield-deploy.py" /usr/local/sbin/riic-endfield-deploy
sudoers="$(mktemp)"
trap 'rm -f -- "$sudoers"' EXIT
printf '%s\n' 'arkdeploy ALL=(root) NOPASSWD: /usr/local/sbin/riic-endfield-deploy *' > "$sudoers"
visudo -cf "$sudoers"
install -o root -g root -m 440 "$sudoers" /etc/sudoers.d/riic-endfield-deploy
if [[ ! -e /etc/riic/endfield-dev.env ]]; then
  install -o root -g root -m 600 /dev/null /etc/riic/endfield-dev.env
  cat > /etc/riic/endfield-dev.env <<'ENV'
NODE_ENV=production
HOST=127.0.0.1
PORT=4286
PLATFORM_API_ORIGIN=http://127.0.0.1:4275
ENV
fi
install -o root -g root -m 644 "$source_dir/endfield-dev.service" /etc/systemd/system/riic-endfield-dev.service
systemctl daemon-reload
systemctl enable riic-endfield-dev.service
echo 'Endfield deployment prerequisites installed; live production release unchanged.'
