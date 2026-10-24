import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
