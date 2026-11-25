"""module/media.sh：用 PATH 桩模拟 cmd / dumpsys / input。"""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "module" / "media.sh"

STUBS = {
    "cmd": r"""#!/bin/sh
echo "$*" >> "$STUB/cmd.log"
if [ -f "$STUB/cmd_error" ]; then cat "$STUB/cmd_error"; exit 0; fi
if [ -f "$STUB/cmd_fail" ]; then echo "cmd: Can't find service: media_session"; exit 20; fi
exit 0
""",
    "dumpsys": r"""#!/bin/sh
echo "$*" >> "$STUB/dumpsys.log"
[ -f "$STUB/dumpsys_fail" ] && exit 1
[ -f "$STUB/dumpsys.txt" ] && cat "$STUB/dumpsys.txt"
exit 0
""",
    "input": r"""#!/bin/sh
echo "$*" >> "$STUB/input.log"
""",
}

NEW_PLAYING = """MEDIA SESSION SERVICE (dumpsys media_session)
  Media button session is com.netease.cloudmusic/MediaSession (userId=0)
    Sessions Stack - have 2 sessions:
      MediaSession com.netease.cloudmusic/MediaSession (userId=0)
        package=com.netease.cloudmusic
        active=true
        state=PlaybackState {state=PLAYING(3), position=1000, buffered position=0, speed=1.0, updated=5, actions=822, custom actions=[], active item id=-1, error=null}
      bili com.bilibili/bili (userId=0)
        active=false
        state=PlaybackState {state=PAUSED(2), position=0, speed=0.0}
"""
NEW_PAUSED = NEW_PLAYING.replace("PLAYING(3)", "PAUSED(2)")
OLD_PLAYING = """    Sessions Stack - have 1 sessions:
      x com.x/x (userId=0)
        active=true
        state=PlaybackState {state=3, position=0, buffered position=0, speed=1.0}
"""
OLD_STOPPED = OLD_PLAYING.replace("state=3,", "state=1,")
BUFFERING = NEW_PLAYING.replace("PLAYING(3)", "BUFFERING(6)")


class MediaScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.stub = self.tmp / "stub"
        self.bin = self.tmp / "bin"
        for d in (self.stub, self.bin):
            d.mkdir(parents=True)
        for name, body in STUBS.items():
            p = self.bin / name
            p.write_text(body)
            p.chmod(0o755)
        shutil.copy(SCRIPT, self.tmp / "media.sh")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_media(self, *args):
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", STUB=str(self.stub))
        r = subprocess.run(["sh", str(self.tmp / "media.sh"), *args], env=env,
                           capture_output=True, text=True, timeout=20)
        return r.returncode, r.stdout

    def log(self, name):
        p = self.stub / f"{name}.log"
        return p.read_text() if p.exists() else ""

    def dumpsys(self, text):
        (self.stub / "dumpsys.txt").write_text(text)

    def test_verbs_dispatch_to_media_session(self):
        cases = {"play": "play", "pause": "pause", "next": "next", "previous": "previous",
                 "stop": "stop", "forward": "fast-forward", "rewind": "rewind"}
        for verb, key in cases.items():
            with self.subTest(verb=verb):
                (self.stub / "cmd.log").unlink(missing_ok=True)
                code, out = self.run_media(verb)
                self.assertEqual(code, 0, out)
                self.assertEqual(self.log("cmd"), f"media_session dispatch {key}\n")
                self.assertIn(f"media={verb} via=session", out)
        self.assertEqual(self.log("input"), "")
        self.assertEqual(self.log("dumpsys"), "")

    def test_toggle_pauses_when_playing_new_format(self):
        self.dumpsys(NEW_PLAYING)
        code, out = self.run_media("toggle")
        self.assertEqual(code, 0)
        self.assertEqual(self.log("cmd"), "media_session dispatch pause\n")
        self.assertIn("media=pause via=session", out)
        self.assertEqual(self.log("dumpsys"), "media_session\n")

    def test_toggle_plays_when_paused(self):
        self.dumpsys(NEW_PAUSED)
        self.run_media("toggle")
        self.assertEqual(self.log("cmd"), "media_session dispatch play\n")

    def test_toggle_old_format(self):
        self.dumpsys(OLD_PLAYING)
        self.run_media("toggle")
        self.assertEqual(self.log("cmd"), "media_session dispatch pause\n")
        (self.stub / "cmd.log").unlink()
        self.dumpsys(OLD_STOPPED)
        self.run_media("toggle")
        self.assertEqual(self.log("cmd"), "media_session dispatch play\n")

    def test_toggle_buffering_counts_as_playing(self):
        self.dumpsys(BUFFERING)
        self.run_media("toggle")
        self.assertEqual(self.log("cmd"), "media_session dispatch pause\n")

    def test_toggle_without_sessions_plays(self):
        self.dumpsys("MEDIA SESSION SERVICE (dumpsys media_session)\n    Sessions Stack - have 0 sessions:\n")
        self.run_media("toggle")
        self.assertEqual(self.log("cmd"), "media_session dispatch play\n")

    def test_toggle_unreadable_state_falls_back_to_play_pause(self):
        (self.stub / "dumpsys_fail").touch()
        self.run_media("toggle")
        self.assertEqual(self.log("cmd"), "media_session dispatch play-pause\n")

    def test_cmd_failure_falls_back_to_keyevent(self):
        (self.stub / "cmd_fail").touch()
        cases = {"play": 126, "pause": 127, "next": 87, "previous": 88, "stop": 86, "forward": 90, "rewind": 89}
        for verb, code in cases.items():
            with self.subTest(verb=verb):
                (self.stub / "input.log").unlink(missing_ok=True)
                rc, out = self.run_media(verb)
                self.assertEqual(rc, 0, out)
                self.assertEqual(self.log("input"), f"keyevent {code}\n")
                self.assertIn(f"media={verb} via=keyevent", out)

    def test_cmd_error_text_falls_back(self):
        (self.stub / "cmd_error").write_text("Error: unknown dispatch code 'pause'\n")
        self.dumpsys(NEW_PLAYING)
        rc, out = self.run_media("toggle")
        self.assertEqual(rc, 0)
        self.assertEqual(self.log("input"), "keyevent 127\n")
        self.assertIn("via=keyevent", out)

    def test_toggle_fallback_unknown_state_uses_play_pause_key(self):
        (self.stub / "cmd_fail").touch()
        (self.stub / "dumpsys_fail").touch()
        self.run_media("toggle")
        self.assertEqual(self.log("input"), "keyevent 85\n")

    def test_invalid_verb(self):
        for args in ((), ("volume",), ("next; reboot",)):
            with self.subTest(args=args):
                rc, out = self.run_media(*args)
                self.assertEqual(rc, 2)
                self.assertIn("usage", out)
        self.assertEqual(self.log("cmd") + self.log("input"), "")


if __name__ == "__main__":
    unittest.main()
