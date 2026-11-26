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
    "app_process": r"""#!/bin/sh
echo "$*" >> "$STUB/app_process.log"
if [ -f "$STUB/launch_timeout" ]; then echo "media.launch=timeout"; echo "media.error=no history player"; exit 1; fi
case "$*" in
  *--recent*) echo "media.app=com.heytap.music"; echo "media.via=event"; echo "media.launch=history" ;;
  *) echo "media.app=$5"; echo "media.launch=app" ;;
esac
""",
    "monkey": r"""#!/bin/sh
echo "$*" >> "$STUB/monkey.log"
""",
    "sleep": r"""#!/bin/sh
exit 0
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
        self.dumpsys(NEW_PAUSED)
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
        self.dumpsys(OLD_PLAYING.replace("state=3,", "state=2,"))
        self.run_media("toggle")
        self.assertEqual(self.log("cmd"), "media_session dispatch play\n")

    def test_toggle_buffering_counts_as_playing(self):
        self.dumpsys(BUFFERING)
        self.run_media("toggle")
        self.assertEqual(self.log("cmd"), "media_session dispatch pause\n")

    EMPTY = "MEDIA SESSION SERVICE (dumpsys media_session)\n    Sessions Stack - have 0 sessions:\n"

    def conf(self, text):
        (self.tmp / "media.conf").write_text(text)

    def test_idle_default_resumes_recent_player(self):
        for text in (self.EMPTY, OLD_STOPPED):
            for verb in ("toggle", "play"):
                with self.subTest(verb=verb, text=text[:20]):
                    (self.stub / "cmd.log").unlink(missing_ok=True)
                    self.dumpsys(text)
                    rc, out = self.run_media(verb)
                    self.assertEqual(rc, 0)
                    self.assertEqual(self.log("cmd"), "media_session dispatch play\n")
                    self.assertIn("media=play via=session", out)

    def apk(self):
        (self.tmp / "companion").mkdir(exist_ok=True)
        (self.tmp / "companion" / "island.apk").write_bytes(b"PK")

    def test_idle_recent_resumes_history_player_like_control_center(self):
        self.apk()
        self.dumpsys(self.EMPTY)
        rc, out = self.run_media("toggle")
        self.assertEqual(rc, 0, out)
        self.assertIn("media=launch via=history app=com.heytap.music", out)
        self.assertIn("io.github.rczlin.sidekey.island.MediaLaunch --recent", self.log("app_process"))
        self.assertEqual(self.log("cmd"), "")

    def test_idle_recent_falls_back_to_media_button(self):
        self.apk()
        (self.stub / "launch_timeout").touch()
        self.dumpsys(self.EMPTY)
        rc, out = self.run_media("toggle")
        self.assertEqual(rc, 0)
        self.assertIn("media.error=no history player", out)
        self.assertEqual(self.log("cmd"), "media_session dispatch play\n")

    def test_idle_skip_keys_do_nothing(self):
        self.dumpsys(self.EMPTY)
        for verb in ("next", "previous", "pause", "stop", "forward", "rewind"):
            with self.subTest(verb=verb):
                rc, out = self.run_media(verb)
                self.assertEqual(rc, 0)
                self.assertIn("media=none via=none", out)
        self.assertEqual(self.log("cmd") + self.log("input"), "")

    def test_idle_none_does_nothing(self):
        self.conf("idle=none\n")
        empty_like = NEW_PLAYING.replace("PLAYING(3)", "STOPPED(1)").replace("PAUSED(2)", "NONE(0)")
        for text in (self.EMPTY, OLD_STOPPED, empty_like):
            with self.subTest(text=text[:20]):
                self.dumpsys(text)
                rc, out = self.run_media("toggle")
                self.assertEqual(rc, 0)
                self.assertIn("media=none via=none", out)
        self.assertEqual(self.log("cmd") + self.log("input") + self.log("app_process"), "")

    def test_idle_app_launches_chosen_app(self):
        self.conf("idle=app\napp=com.netease.cloudmusic\n")
        self.apk()
        self.dumpsys(self.EMPTY)
        rc, out = self.run_media("toggle")
        self.assertEqual(rc, 0, out)
        self.assertIn("media=launch via=app app=com.netease.cloudmusic", out)
        self.assertIn("io.github.rczlin.sidekey.island.MediaLaunch com.netease.cloudmusic 5000", self.log("app_process"))
        self.assertEqual(self.log("cmd"), "")

    def test_idle_app_timeout_falls_back_to_recent(self):
        self.conf("idle=app\napp=com.netease.cloudmusic\n")
        self.apk()
        (self.stub / "launch_timeout").touch()
        self.dumpsys(self.EMPTY)
        rc, out = self.run_media("play")
        self.assertEqual(rc, 0)
        self.assertEqual(self.log("cmd"), "media_session dispatch play\n")

    def test_idle_app_without_companion_uses_monkey(self):
        self.conf("idle=app\napp=com.netease.cloudmusic\n")
        self.dumpsys(self.EMPTY)
        self.run_media("toggle")
        self.assertEqual(self.log("monkey"), "-p com.netease.cloudmusic -c android.intent.category.LAUNCHER 1\n")
        self.assertEqual(self.log("cmd"), "media_session dispatch play\n")

    def test_idle_app_rejects_bad_package(self):
        for bad in ("com.a;reboot", "nodot", "", "com..a"):
            with self.subTest(bad=bad):
                (self.stub / "cmd.log").unlink(missing_ok=True)
                self.conf(f"idle=app\napp={bad}\n")
                self.dumpsys(self.EMPTY)
                self.run_media("toggle")
                self.assertEqual(self.log("cmd"), "media_session dispatch play\n")
        self.assertEqual(self.log("app_process") + self.log("monkey"), "")

    def test_launch_env_forces_recent(self):
        self.conf("idle=none\n")
        self.dumpsys(OLD_STOPPED)
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", STUB=str(self.stub), SIDEKEY_MEDIA_LAUNCH="1")
        subprocess.run(["sh", str(self.tmp / "media.sh"), "toggle"], env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(self.log("cmd"), "media_session dispatch play\n")

    def test_playing_session_ignores_idle_setting(self):
        self.conf("idle=app\napp=com.netease.cloudmusic\n")
        self.dumpsys(NEW_PLAYING)
        self.run_media("toggle")
        self.assertEqual(self.log("cmd"), "media_session dispatch pause\n")
        self.assertEqual(self.log("app_process"), "")

    def test_toggle_unreadable_state_falls_back_to_play_pause(self):
        (self.stub / "dumpsys_fail").touch()
        self.run_media("toggle")
        self.assertEqual(self.log("cmd"), "media_session dispatch play-pause\n")

    def test_cmd_failure_falls_back_to_keyevent(self):
        self.dumpsys(NEW_PAUSED)
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
