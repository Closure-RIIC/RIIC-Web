import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock
from email.message import Message
import urllib.error
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("endfield_deploy", Path(__file__).with_name("endfield-deploy.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
SHA, TREE = "a" * 40, "b" * 40


class ReleaseArchiveTests(unittest.TestCase):
    def extract(self, additions=(), metadata=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "release.tar.gz"
            identity = metadata or {"formatVersion": 1, "kind": "riic-endfield", "releaseSha": SHA, "releaseTreeSha": TREE}
            with tarfile.open(archive, "w:gz") as bundle:
                for name, content in [(".release-artifact.json", json.dumps(identity)), ("runtime/server/index.mjs", "export default {};")]:
                    data = content.encode()
                    entry = tarfile.TarInfo(name)
                    entry.size = len(data)
                    bundle.addfile(entry, io.BytesIO(data))
                for entry in additions:
                    bundle.addfile(entry, io.BytesIO(b""))
            output = root / "output"
            output.mkdir()
            installer.extract_release(archive, output, SHA, TREE)
            self.assertTrue((output / "runtime/server/index.mjs").is_file())

    def test_valid_release(self):
        self.extract()

    def test_public_release(self):
        self.extract(metadata={"formatVersion": 1, "kind": "riic-endfield", "releaseSha": SHA, "releaseTreeSha": TREE, "accessMode": "public"})

    def test_rejects_invalid_access_mode(self):
        with self.assertRaises(ValueError):
            self.extract(metadata={"formatVersion": 1, "kind": "riic-endfield", "releaseSha": SHA, "releaseTreeSha": TREE, "accessMode": "unknown"})

    def test_rejects_traversal_and_unexpected_paths(self):
        for path in ("../escape", "/etc/passwd", "runtime/../../escape", "runtime\\escape", ".env", "runtime/.env.production", "unknown"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.extract([tarfile.TarInfo(path)])

    def test_rejects_links_and_special_files(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE):
            entry = tarfile.TarInfo("runtime/unsafe")
            entry.type, entry.linkname = kind, "/etc/passwd"
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.extract([entry])

    def test_rejects_duplicate_paths(self):
        with self.assertRaises(ValueError):
            self.extract([tarfile.TarInfo("./runtime/server/index.mjs")])

    def test_rejects_wrong_release_identity(self):
        with self.assertRaises(ValueError):
            self.extract(metadata={"formatVersion": 1, "kind": "riic-endfield", "releaseSha": "c" * 40, "releaseTreeSha": TREE})


class ReleaseHealthTests(unittest.TestCase):
    def probe(self, mode, status=200, body=b'data-app-scroll-area="endfield"', content_type="text/html", current=True):
        with tempfile.TemporaryDirectory() as temporary:
            release = Path(temporary)
            metadata = {} if mode is None else {"accessMode": mode}
            (release / ".release-artifact.json").write_text(json.dumps(metadata))
            headers = Message()
            headers["Content-Type"] = content_type
            response = mock.MagicMock(status=status, headers=headers)
            response.__enter__.return_value = response
            response.read.return_value = body
            error = urllib.error.HTTPError("http://127.0.0.1/skills", status, "failed", headers, io.BytesIO(body)) if status >= 400 else None
            with mock.patch.object(installer.subprocess, "check_output", return_value="123"), \
                    mock.patch.object(installer.Path, "resolve", return_value=release if current else release / "stale"), \
                    mock.patch.object(installer.urllib.request, "urlopen", return_value=response, side_effect=error):
                return installer.healthy(4186, "fixture-service", release)

    def test_public_release_serves_application(self):
        self.assertTrue(self.probe("public"))

    def test_public_release_rejects_closed_gate_or_unrelated_response(self):
        self.assertFalse(self.probe("public", 404, b"Not Found"))
        self.assertFalse(self.probe("public", body=b"upstream unavailable"))
        self.assertFalse(self.probe("public", content_type="text/plain"))

    def test_legacy_preview_rollback_requires_closed_gate(self):
        self.assertTrue(self.probe(None, 404, b"Not Found"))
        self.assertTrue(self.probe("admin", 404, b"Not Found"))
        self.assertFalse(self.probe(None))
        self.assertFalse(self.probe("admin", 404, b"unrelated not found"))

    def test_stale_process_or_invalid_mode_is_unhealthy(self):
        self.assertFalse(self.probe("public", current=False))
        self.assertFalse(self.probe("unknown"))


if __name__ == "__main__":
    unittest.main()
