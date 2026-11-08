"""Run the workflow's actual transfer body against an isolated rsync/SSH fixture."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import textwrap
import unittest

REPOSITORY = Path(__file__).resolve().parent.parent


@unittest.skipUnless(os.name == "posix" and shutil.which("rsync"), "Linux and rsync required")
class TransferTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="arknights-transfer-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source"
        self.source.mkdir()
        (self.source / "app-oldhash.js").write_bytes(os.urandom(2 * 1024 * 1024))
        self.remote = self.root / "remote"
        self.remote.mkdir()
        self.cache = self.remote / ".cache/riic-web/development-standalone-tree"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.archive = self.root / "release.tar.gz"
        self.github_env = self.root / "github-env"
        workflow = (REPOSITORY / ".github/workflows/deploy.yml").read_text()
        section = workflow.split("      - name: Sync standalone release tree")[1].split("\n      - name:")[0]
        self.script = textwrap.dedent(section.split("        run: |\n")[1])
        self.env = {**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                    "DEPLOY_HOST": "fixture.invalid", "DEPLOY_SSH_USER": "arkdeploy",
                    "DEPLOYMENT_ENV": "development", "DEPLOY_SHA": "a" * 40,
                    "SOURCE_DATE_EPOCH": "1700000000", "DEPLOY_ARTIFACT_ROOT": str(self.source),
                    "DEPLOY_LOCAL_ARCHIVE": str(self.archive), "RUNNER_TEMP": str(self.root),
                    "GITHUB_ENV": str(self.github_env), "GITHUB_STEP_SUMMARY": str(self.root / "summary"),
                    "TRANSFER_FIXTURE_ROOT": str(self.remote), "TRANSFER_FIXTURE_RSYNC": shutil.which("rsync")}
        self.command("ssh", r'''
import os, subprocess, sys
from pathlib import Path
args = sys.argv[1:]
root = Path(os.environ["TRANSFER_FIXTURE_ROOT"])
if "-O" in args:
    Path(args[args.index("-S") + 1]).unlink(missing_ok=True)
    (root / "closed").touch()
    sys.exit(0)
if "-fN" in args:
    counter = root / "attempts"
    attempts = int(counter.read_text()) + 1 if counter.exists() else 1
    counter.write_text(str(attempts))
    if attempts <= int(os.environ.get("TRANSFER_CONNECT_FAILURES", "0")):
        sys.exit(255)
    Path(next(arg.removeprefix("ControlPath=") for arg in args if arg.startswith("ControlPath="))).touch()
    sys.exit(0)
assert "ControlMaster=no" in args and "ProxyCommand=false" in args
if not Path(args[args.index("-S") + 1]).exists():
    sys.exit(255)
script = args[-1].replace("$HOME", str(root)).replace("/tmp/arknights-infra-", str(root / "arknights-infra-"))
if os.environ.get("TRANSFER_CORRUPT_CACHE") and "--sort=name" in script:
    (root / ".cache/riic-web/development-standalone-tree/corrupt").write_text("corrupt")
sys.exit(subprocess.run(["bash", "-c", script]).returncode)
''')
        self.command("rsync", r'''
import os, subprocess, sys
from pathlib import Path
args = sys.argv[1:]
root = os.environ["TRANSFER_FIXTURE_ROOT"]
args[-1] = args[-1].replace("arkdeploy@fixture.invalid:", root + "/")
result = subprocess.run([os.environ["TRANSFER_FIXTURE_RSYNC"], "--no-whole-file", *args])
if os.environ.get("TRANSFER_INTERRUPT"):
    (Path(root) / ".cache/riic-web/development-standalone-tree/partial").write_text("partial")
    sys.exit(23)
sys.exit(result.returncode)
''')

    def command(self, name, script):
        path = self.bin / name
        path.write_text("#!/usr/bin/env python3\n" + script)
        path.chmod(0o755)

    def connection(self, operation, **overrides):
        result = subprocess.run(["bash", str(REPOSITORY / "scripts/deploy-ssh.sh"), operation],
                                env={**self.env, **overrides}, capture_output=True, text=True, timeout=15)
        if self.github_env.exists():
            self.env["DEPLOY_SSH_CONTROL_SOCKET"] = self.github_env.read_text().strip().split("=", 1)[1]
        return result

    def open(self, **overrides):
        result = self.connection("open", **overrides)
        self.addCleanup(lambda: self.connection("close"))
        return result

    def transfer(self, **overrides):
        subprocess.run(["bash", str(REPOSITORY / "scripts/pack-endfield-release.sh"),
                        str(self.source), str(self.archive), "1700000000"], check=True, capture_output=True)
        self.env["DEPLOY_ARCHIVE_SHA256"] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.env["DEPLOY_ARCHIVE_BYTES"] = str(self.archive.stat().st_size)
        return subprocess.run(["bash", "-c", self.script], env={**self.env, **overrides},
                              capture_output=True, text=True, timeout=30)

    def test_renamed_assets_use_deltas_and_reproduce_the_verified_archive(self):
        self.assertEqual(self.open().returncode, 0)
        first = self.transfer()
        self.assertEqual(first.returncode, 0, first.stderr)
        old = self.source / "app-oldhash.js"
        (self.source / "app-newhash.js").write_bytes(old.read_bytes() + b"small change")
        old.unlink()
        second = self.transfer()
        self.assertEqual(second.returncode, 0, second.stderr)
        literal = int(re.search(r"Literal data: ([\d,]+)", second.stdout)[1].replace(",", ""))
        self.assertLess(literal, 100_000)
        self.assertFalse((self.cache / "app-oldhash.js").exists())
        remote_archive = self.remote / f'arknights-infra-development-{"a" * 40}.tar.gz'
        self.assertEqual(remote_archive.read_bytes(), self.archive.read_bytes())
        self.assertEqual((self.remote / "attempts").read_text(), "1")

    def test_interruption_resumes_and_corruption_never_publishes_a_new_archive(self):
        self.assertEqual(self.open().returncode, 0)
        self.assertNotEqual(self.transfer(TRANSFER_INTERRUPT="1").returncode, 0)
        self.assertFalse(list(self.remote.glob("*.tar.gz")))
        resumed = self.transfer()
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        remote_archive = next(self.remote.glob("*.tar.gz"))
        previous = remote_archive.read_bytes()
        (self.source / "new-file").write_text("new")
        self.assertNotEqual(self.transfer(TRANSFER_CORRUPT_CACHE="1").returncode, 0)
        self.assertEqual(remote_archive.read_bytes(), previous)

    def test_symlinks_and_hardlinks_are_rejected_without_touching_their_targets(self):
        self.assertEqual(self.open().returncode, 0)
        self.cache.parent.mkdir(parents=True, mode=0o700)
        self.cache.symlink_to(self.source, target_is_directory=True)
        self.assertNotEqual(self.transfer().returncode, 0)
        self.cache.unlink()
        self.cache.mkdir(mode=0o700)
        outside = self.root / "live-release-file"
        outside.write_text("live release")
        os.link(outside, self.cache / "shared")
        self.assertNotEqual(self.transfer().returncode, 0)
        self.assertEqual(outside.read_text(), "live release")
        self.assertFalse(list(self.remote.glob("*.tar.gz")))

    def test_only_connecting_retries_and_lost_transport_never_reconnects(self):
        self.assertEqual(self.open(TRANSFER_CONNECT_FAILURES="1").returncode, 0)
        self.assertEqual((self.remote / "attempts").read_text(), "2")
        Path(self.env["DEPLOY_SSH_CONTROL_SOCKET"]).unlink()
        self.assertNotEqual(self.transfer().returncode, 0)
        self.assertEqual((self.remote / "attempts").read_text(), "2")
        self.assertEqual(self.connection("close").returncode, 0)

    def test_connection_failures_are_bounded_and_cleanup_removes_the_socket_directory(self):
        self.assertNotEqual(self.open(TRANSFER_CONNECT_FAILURES="9").returncode, 0)
        self.assertEqual((self.remote / "attempts").read_text(), "3")
        self.assertEqual(self.connection("close").returncode, 0)
        self.assertFalse(Path(self.env["DEPLOY_SSH_CONTROL_SOCKET"]).parent.exists())


if __name__ == "__main__":
    unittest.main()
