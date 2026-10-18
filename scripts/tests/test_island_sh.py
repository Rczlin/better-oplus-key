"""module/island.sh：用 PATH 桩模拟 pm / dumpsys / cmd / getprop。"""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "module" / "island.sh"

STUBS = {
    "pm": r"""#!/bin/sh
echo "$*" >> "$STUB/pm.log"
case "$1" in
  path) [ -f "$STUB/installed" ] && echo "package:/data/app/x/base.apk"; exit 0 ;;
  install)
    cat > "$STUB/received.apk"
    if [ -f "$STUB/fail_sig_once" ]; then rm "$STUB/fail_sig_once"; echo "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]"; exit 1; fi
    if [ -f "$STUB/fail" ]; then echo "Failure [INSTALL_FAILED_INTERNAL_ERROR]"; exit 1; fi
    touch "$STUB/installed"; echo "Success" ;;
  uninstall) rm -f "$STUB/installed"; echo "Success" ;;
  grant) touch "$STUB/granted" ;;
esac
""",
    "dumpsys": r"""#!/bin/sh
[ -f "$STUB/granted" ] && echo "      android.permission.POST_NOTIFICATIONS: granted=true, flags=[ USER_SET ]"
exit 0
""",
    "cmd": r"""#!/bin/sh
echo "$*" >> "$STUB/cmd.log"
echo "Broadcast completed: result=0"
""",
    "getprop": r"""#!/bin/sh
[ "$1" = ro.build.version.sdk ] && echo 36
""",
}


class IslandScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.stub = self.tmp / "stub"
        self.bin = self.tmp / "bin"
        self.moddir = self.tmp / "module"
        for d in (self.stub, self.bin, self.moddir / "companion"):
            d.mkdir(parents=True)
        for name, body in STUBS.items():
            p = self.bin / name
            p.write_text(body)
            p.chmod(0o755)
        shutil.copy(SCRIPT, self.moddir / "island.sh")
        self.apk = self.moddir / "companion" / "island.apk"
        self.apk.write_bytes(b"PK fake apk v1")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_island(self, *args):
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", STUB=str(self.stub))
        r = subprocess.run(["sh", str(self.moddir / "island.sh"), *args], env=env,
                           capture_output=True, text=True, timeout=20)
        return r.returncode, r.stdout

    def pm_log(self):
        p = self.stub / "pm.log"
        return p.read_text() if p.exists() else ""

    def test_install_streams_apk_and_grants(self):
        code, out = self.run_island("install")
        self.assertEqual(code, 0)
        self.assertIn("island=installed", out)
        self.assertIn(f"install -r -d -S {self.apk.stat().st_size}", self.pm_log())
        self.assertEqual((self.stub / "received.apk").read_bytes(), self.apk.read_bytes())
        self.assertIn("grant io.github.rczlin.sidekey.island android.permission.POST_NOTIFICATIONS", self.pm_log())

    def test_unchanged_apk_only_grants(self):
        self.run_island("install")
        (self.stub / "pm.log").unlink()
        code, out = self.run_island("install")
        self.assertEqual(code, 0)
        self.assertIn("island=installed", out)
        self.assertNotIn("install -r", self.pm_log())
        self.assertIn("grant ", self.pm_log())

    def test_changed_apk_reinstalls(self):
        self.run_island("install")
        self.apk.write_bytes(b"PK fake apk v2")
        (self.stub / "pm.log").unlink()
        self.run_island("install")
        self.assertIn("install -r", self.pm_log())

    def test_removed_app_reinstalls_even_if_stamp_matches(self):
        self.run_island("install")
        (self.stub / "installed").unlink()
        (self.stub / "pm.log").unlink()
        self.run_island("install")
        self.assertIn("install -r", self.pm_log())

    def test_signature_conflict_uninstalls_then_installs(self):
        (self.stub / "installed").touch()
        (self.stub / "fail_sig_once").touch()
        code, out = self.run_island("install")
        self.assertEqual(code, 0, out)
        self.assertIn("island=installed", out)
        log = self.pm_log()
        self.assertIn("uninstall io.github.rczlin.sidekey.island", log)
        self.assertEqual(log.count("install -r"), 2)

    def test_install_failure_reports_and_keeps_no_stamp(self):
        (self.stub / "fail").touch()
        code, out = self.run_island("install")
        self.assertNotEqual(code, 0)
        self.assertIn("island=failed", out)
        self.assertIn("island.error=Failure [INSTALL_FAILED_INTERNAL_ERROR]", out)
        self.assertFalse((self.moddir / "companion" / ".installed").exists())

    def test_missing_apk(self):
        self.apk.unlink()
        code, out = self.run_island("install")
        self.assertNotEqual(code, 0)
        self.assertIn("island=missing-apk", out)
        self.assertNotIn("install", self.pm_log())

    def test_status(self):
        _, out = self.run_island("status")
        self.assertIn("island.apk=1", out)
        self.assertIn("island.installed=0", out)
        self.assertIn("island.granted=0", out)
        self.assertIn("island.sdk=36", out)
        self.run_island("install")
        _, out = self.run_island("status")
        self.assertIn("island.installed=1", out)
        self.assertIn("island.granted=1", out)

    def test_test_broadcast(self):
        code, out = self.run_island("test")
        self.assertEqual(code, 0)
        self.assertIn("island=sent", out)
        log = (self.stub / "cmd.log").read_text()
        self.assertIn("activity broadcast --user 0 -f 0x10000020 -a io.github.rczlin.sidekey.island.SHOW "
                      "-n io.github.rczlin.sidekey.island/.IslandReceiver --ez test true", log)

    def test_unknown_action(self):
        code, out = self.run_island("bogus")
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
