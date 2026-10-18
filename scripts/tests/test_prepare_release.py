import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "prepare-release.py"


class PrepareReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "module").mkdir()
        (self.root / "dist").mkdir()
        (self.root / "module/module.prop").write_text(
            "version=0.4.0\nversionCode=4\n", encoding="utf-8"
        )
        (self.root / "dist/oplus-sidekey-0.4.0.zip").write_bytes(b"package")
        (self.root / "CHANGELOG.md").write_text("# 0.4.0\n更新说明\n", encoding="utf-8")

    def run_release(self, tag="v0.4.0"):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--tag", tag,
             "--repository", "Rczlin/better-oplus-key"],
            cwd=self.root, capture_output=True, text=True, encoding="utf-8",
        )

    def test_generates_kernelsu_metadata_for_the_packaged_version(self):
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.root / "dist/update.json").read_text()), {
            "version": "0.4.0",
            "versionCode": 4,
            "zipUrl": "https://github.com/Rczlin/better-oplus-key/releases/download/v0.4.0/oplus-sidekey-0.4.0.zip",
            "changelog": "https://github.com/Rczlin/better-oplus-key/releases/download/v0.4.0/changelog.md",
        })
        self.assertEqual((self.root / "dist/changelog.md").read_bytes(),
                         (self.root / "CHANGELOG.md").read_bytes())

    def test_rejects_a_tag_that_does_not_match_module_version(self):
        result = self.run_release("v0.5.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tag", result.stderr)
        self.assertFalse((self.root / "dist/update.json").exists())

    def test_rejects_missing_installable_zip(self):
        (self.root / "dist/oplus-sidekey-0.4.0.zip").unlink()
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("zip", result.stderr)

    def test_rejects_invalid_version_codes(self):
        for code in ("0", "-1", "four", "2147483648"):
            with self.subTest(code=code):
                (self.root / "module/module.prop").write_text(
                    f"version=0.4.0\nversionCode={code}\n", encoding="utf-8"
                )
                result = self.run_release()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("versionCode", result.stderr)


if __name__ == "__main__":
    unittest.main()
