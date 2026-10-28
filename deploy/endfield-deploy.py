#!/usr/bin/python3
"""Root-owned, fixed-target installer for verified Endfield release archives."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import urllib.error

TARGETS = {
    "production": ("/srv/riic-endfield", "riic-endfield", 4186),
    "development": ("/srv/riic-endfield-dev", "riic-endfield-dev", 4286),
}


def extract_release(archive, destination, sha, tree):
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) > 100000 or sum(item.size for item in members) > 1024**3:
            raise ValueError("Release archive exceeds limits")
        seen = set()
        for item in members:
            path = PurePosixPath(item.name)
            if path.is_absolute() or ".." in path.parts or "\\" in item.name:
                raise ValueError("Unsafe archive path")
            if not item.isdir() and not item.isfile():
                raise ValueError("Release must contain only regular files and directories")
            if not path.parts:
                if not item.isdir():
                    raise ValueError("Invalid archive root")
                continue
            if path.parts[0] not in ("runtime", "package.json", ".release-artifact.json"):
                raise ValueError("Unexpected release entry")
            if any(part == ".env" or part.startswith(".env.") for part in path.parts):
                raise ValueError("Release must not contain environment files")
            if str(path) in seen:
                raise ValueError("Duplicate archive entry")
            seen.add(str(path))
        bundle.extractall(destination, filter="data")
    metadata = json.loads((destination / ".release-artifact.json").read_text())
    access_mode = metadata.pop("accessMode", "admin")
    if access_mode not in ("admin", "public"):
        raise ValueError("Invalid Endfield access mode")
    if metadata != {"formatVersion": 1, "kind": "riic-endfield", "releaseSha": sha, "releaseTreeSha": tree}:
        raise ValueError("Release identity mismatch")
    if not (destination / "runtime/server/index.mjs").is_file():
        raise ValueError("Missing server entry")


def switch_current(root, release):
    temporary = root / ".current-next"
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(release)
    temporary.replace(root / "current")


def healthy(port, service, release):
    try:
        pid = subprocess.check_output(["systemctl", "show", service, "--property=MainPID", "--value"], text=True, timeout=10).strip()
        if not pid.isdecimal() or pid == "0" or Path(f"/proc/{pid}/cwd").resolve() != release:
            return False
        # Legacy preview artifacts remain valid rollback targets. Public releases
        # must serve the actual application, not merely return a successful status.
        access_mode = json.loads((release / ".release-artifact.json").read_text()).get("accessMode", "admin")
        if access_mode not in ("admin", "public"):
            return False
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/skills", timeout=10) as response:
                return access_mode == "public" and response.status == 200 and \
                    response.headers.get_content_type() == "text/html" and \
                    b'data-app-scroll-area="endfield"' in response.read(2 * 1024**2)
        except urllib.error.HTTPError as response:
            with response:
                return access_mode == "admin" and response.code == 404 and response.read() == b"Not Found"
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def deploy(environment, sha, tree, digest):
    import fcntl
    import grp
    import pwd

    if os.geteuid() != 0 or environment not in TARGETS:
        raise ValueError("Installer requires root and a known environment")
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or not re.fullmatch(r"[0-9a-f]{40}", tree) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("Invalid release identity")
    root_name, service, port = TARGETS[environment]
    root = Path(root_name)
    if root.is_symlink() or root.stat().st_uid != 0 or root.stat().st_mode & 0o022:
        raise ValueError("Application root must be root-owned and not writable by other users")
    releases = root / "releases"
    if releases.is_symlink() or releases.stat().st_uid != 0 or releases.stat().st_mode & 0o022:
        raise ValueError("Release directory must be protected")
    with open(f"/run/lock/riic-endfield-{environment}.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        source = Path(f"/srv/riic-endfield-deploy/{environment}/{sha}.tar.gz")
        descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as stream, tempfile.TemporaryDirectory(prefix=".deploy-", dir=root) as staging:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != pwd.getpwnam("arkdeploy").pw_uid or info.st_nlink != 1 or info.st_size > 512 * 1024**2:
                raise ValueError("Invalid incoming archive")
            archive = Path(staging) / "release.tar.gz"
            with archive.open("wb") as target:
                shutil.copyfileobj(stream, target)
            with archive.open("rb") as target:
                if hashlib.file_digest(target, "sha256").hexdigest() != digest:
                    raise ValueError("Archive checksum mismatch")
            payload = Path(staging) / "payload"
            payload.mkdir()
            extract_release(archive, payload, sha, tree)
            (payload / ".archive-sha256").write_text(digest + "\n")
            group = grp.getgrnam(service).gr_gid
            for path in [payload, *payload.rglob("*")]:
                os.chown(path, 0, group)
                path.chmod(0o750 if path.is_dir() else 0o640)
            release = releases / sha
            if release.exists():
                if release.is_symlink() or (release / ".archive-sha256").read_text().strip() != digest:
                    raise ValueError("Existing release differs from the verified archive")
            else:
                payload.rename(release)
        current = root / "current"
        previous = current.resolve(strict=True) if current.is_symlink() else None
        if previous and previous.parent != releases:
            raise ValueError("Rollback target must belong to this application")
        switch_current(root, release)
        try:
            subprocess.run(["systemctl", "restart", service], check=True, timeout=60)
            for attempt in range(30):
                if healthy(port, service, release):
                    break
                time.sleep(2)
            else:
                raise RuntimeError("New release did not become healthy")
            for sample in range(12 if environment == "production" else 3):
                time.sleep(5)
                if not healthy(port, service, release):
                    raise RuntimeError("Release failed health observation")
        except BaseException:
            if previous:
                switch_current(root, previous)
                subprocess.run(["systemctl", "restart", service], check=True, timeout=60)
                for attempt in range(30):
                    if healthy(port, service, previous):
                        break
                    time.sleep(2)
                else:
                    raise RuntimeError("Rollback did not become healthy")
                print(f"Rolled back {environment} to {previous.name}", flush=True)
            else:
                subprocess.run(["systemctl", "stop", service], check=True, timeout=60)
                current.unlink(missing_ok=True)
            raise
        source.unlink(missing_ok=True)
        print(f"Endfield {environment} healthy: {sha}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit("usage: riic-endfield-deploy <environment> <sha> <tree> <sha256>")
    deploy(*sys.argv[1:])
