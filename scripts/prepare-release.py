"""Generate KernelSU update assets for an already packaged stable release."""

import argparse
import json
from pathlib import Path
import re
import shutil


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--tag", required=True)
parser.add_argument("--repository", required=True)
args = parser.parse_args()

props = dict(line.split("=", 1) for line in
             Path("module/module.prop").read_text(encoding="utf-8").splitlines()
             if "=" in line and not line.startswith("#"))
version = props.get("version", "")
if not re.fullmatch(r"\d+\.\d+\.\d+", version) or args.tag != f"v{version}":
    parser.error("release tag must match module.prop version: v<major>.<minor>.<patch>")
code = props.get("versionCode", "")
if not code.isascii() or not code.isdecimal() or not 0 < int(code) <= 2147483647:
    parser.error("versionCode must be a positive 32-bit integer")

archive = f"oplus-sidekey-{version}.zip"
if not Path("dist", archive).is_file():
    parser.error(f"missing packaged zip: dist/{archive}")

base = f"https://github.com/{args.repository}/releases/download/{args.tag}"
metadata = {
    "version": version,
    "versionCode": int(code),
    "zipUrl": f"{base}/{archive}",
    "changelog": f"{base}/changelog.md",
}
shutil.copyfile("CHANGELOG.md", "dist/changelog.md")
Path("dist/update.json").write_text(
    json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
)
