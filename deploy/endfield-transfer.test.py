"""Exercise the real transfer script with rsync in an isolated local SSH fixture."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPOSITORY = Path(__file__).resolve().parent.parent
SHA = "a" * 40
TREE = "b" * 40


@unittest.skipUnless(os.name == "posix" and shutil.which("rsync"), "Linux and rsync required")
class TransferTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="endfield-transfer-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        (self.source / "runtime/server").mkdir(parents=True)
        (self.source / "runtime/server/index.mjs").write_text("export const version = 1;\n")
        # Incompressible input makes an accidental full re-upload observable.
        (self.source / "runtime/stable.bin").write_bytes(os.urandom(2 * 1024 * 1024))
        (self.source / "runtime/deleted.txt").write_text("old release only")
        (self.source / "package.json").write_text('{"type":"module"}\n')
        (self.source / ".release-artifact.json").write_text(json.dumps({
            "formatVersion": 1, "kind": "riic-endfield", "releaseSha": SHA, "releaseTreeSha": TREE,
        }))
        self.download = self.root / "download"
        self.download.mkdir()
        self.remote = self.root / "remote"
        (self.remote / "development").mkdir(parents=True, mode=0o700)
        (self.remote / "production").mkdir(mode=0o700)
        self.cache = self.remote / "development/tree-cache"
        self.archive = self.download / f"endfield-development-{SHA}.tar.gz"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = {**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                    "DEPLOYMENT_ENV": "development", "DEPLOY_SHA": SHA, "DEPLOY_TREE_SHA": TREE,
                    "SOURCE_DATE_EPOCH": "1700000000", "DEPLOY_HOST": "fixture.invalid", "DEPLOY_SSH_USER": "arkdeploy",
                    "ENDFIELD_ARTIFACT_DIRECTORY": str(self.download), "RUNNER_TEMP": str(self.root),
                    "GITHUB_STEP_SUMMARY": str(self.root / "summary"), "TRANSFER_FIXTURE_ROOT": str(self.remote),
                    "TRANSFER_FIXTURE_RSYNC": shutil.which("rsync")}
        self.command("ssh", r'''
import hashlib, os, shlex, subprocess, sys
from pathlib import Path
root = Path(os.environ["TRANSFER_FIXTURE_ROOT"])
args = sys.argv[1:]
target = next(i for i, value in enumerate(args) if value == "arkdeploy@fixture.invalid")
remote = args[target + 1:]
if len(remote) == 1:
    remote = shlex.split(remote[0])
def localize(value):
    return value.replace("/srv/riic-endfield-deploy", str(root))
if remote[0] == "sudo":
    environment, sha, tree, digest = remote[-4:]
    archive = root / environment / (sha + ".tar.gz")
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == digest
    with (root / "installed").open("a") as record:
        record.write(digest + "\n")
    sys.exit(0)
script = sys.stdin.read()
if os.environ.get("TRANSFER_CORRUPT_CACHE") and "--sort=name" in script:
    (root / "development/tree-cache/runtime/server/index.mjs").write_text("corrupt")
sys.exit(subprocess.run([localize(value) for value in remote], input=localize(script), text=True).returncode)
''')
        self.command("rsync", r'''
import os, subprocess, sys
from pathlib import Path
args = sys.argv[1:]
if not args:
    sys.exit(0)
root = os.environ["TRANSFER_FIXTURE_ROOT"]
args = [value.replace("arkdeploy@fixture.invalid:/srv/riic-endfield-deploy", root) for value in args]
result = subprocess.run([os.environ["TRANSFER_FIXTURE_RSYNC"], "--no-whole-file", *args])
if os.environ.get("TRANSFER_INTERRUPT"):
    (Path(root) / "development/tree-cache/runtime/server/index.mjs").write_text("partial")
    sys.exit(23)
sys.exit(result.returncode)
''')
        self.command("node", r'''
import os, sys
assert sys.argv[-1] == "assert-current"
sys.exit(1 if os.environ.get("TRANSFER_STALE") else 0)
''')

    def command(self, name, script):
        target = self.bin / name
        target.write_text("#!/usr/bin/env python3\n" + script)
        target.chmod(0o755)

    def pack(self):
        subprocess.run(["bash", str(REPOSITORY / "scripts/pack-endfield-release.sh"), str(self.source), str(self.archive), "1700000000"], check=True, capture_output=True)
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        (self.download / "SHA256SUMS").write_text(f"{digest}  {self.archive.name}\n")
        return digest

    def transfer(self, **overrides):
        return subprocess.run(["bash", str(REPOSITORY / "scripts/deploy-endfield.sh")], env={**self.env, **overrides}, text=True, capture_output=True, timeout=60)

    def installed(self):
        record = self.remote / "installed"
        return record.read_text().splitlines() if record.exists() else []

    def test_delta_deletion_and_isolation(self):
        first = self.pack()
        result = self.transfer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.installed(), [first])
        # Existing production and rollback files must not change with the cache.
        live = self.root / "live"
        shutil.copytree(self.source, live)
        (self.source / "runtime/deleted.txt").unlink()
        (self.source / "runtime/server/index.mjs").write_text("export const version = 2;\n")
        second = self.pack()
        result = self.transfer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.installed(), [first, second])
        self.assertFalse((self.cache / "runtime/deleted.txt").exists())
        self.assertEqual((live / "runtime/server/index.mjs").read_text(), "export const version = 1;\n")
        self.assertTrue((live / "runtime/deleted.txt").exists())
        sent = next(line for line in result.stdout.splitlines() if line.startswith("Total bytes sent:"))
        self.assertLess(int(sent.split(":")[1].strip().replace(",", "")), self.archive.stat().st_size // 5)
        self.assertFalse(any((self.remote / "production").iterdir()))

    def test_interruption_checksum_failure_and_stale_release_never_install(self):
        self.pack()
        self.assertNotEqual(self.transfer(TRANSFER_INTERRUPT="1").returncode, 0)
        self.assertEqual(self.installed(), [])
        resumed = self.transfer()
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(len(self.installed()), 1)
        self.assertNotEqual(self.transfer(TRANSFER_CORRUPT_CACHE="1").returncode, 0)
        self.assertEqual(len(self.installed()), 1)
        self.assertNotEqual(self.transfer(TRANSFER_STALE="1").returncode, 0)
        self.assertEqual(len(self.installed()), 1)
        # An empty cache is a safe full-transfer fallback.
        shutil.rmtree(self.cache)
        restored = self.transfer()
        self.assertEqual(restored.returncode, 0, restored.stderr)
        self.assertEqual(len(self.installed()), 2)

    def test_cache_links_and_invalid_manifests_fail_before_install(self):
        self.pack()
        self.cache.symlink_to(self.source, target_is_directory=True)
        self.assertNotEqual(self.transfer().returncode, 0)
        self.cache.unlink()
        self.cache.mkdir(mode=0o700)
        os.link(self.source / "runtime/stable.bin", self.cache / "shared.bin")
        self.assertNotEqual(self.transfer().returncode, 0)
        (self.cache / "shared.bin").unlink()
        (self.download / "SHA256SUMS").write_text(f'{"f" * 64}  ../../outside\n')
        self.assertNotEqual(self.transfer().returncode, 0)
        self.assertEqual(self.installed(), [])


if __name__ == "__main__":
    unittest.main()
