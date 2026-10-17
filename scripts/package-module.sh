#!/bin/sh
# 将 module/ 打包为 dist/oplus-sidekey-<version>.zip（与 package-module.ps1 等价）。
# module.prop 位于 zip 根目录；条目使用正斜杠。
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODULE="$ROOT/module"
VERSION=$(sed -n 's/^version=//p' "$MODULE/module.prop")
[ -n "$VERSION" ] || { echo "version not found in module.prop" >&2; exit 1; }
DIST="$ROOT/dist"
OUT="$DIST/oplus-sidekey-$VERSION.zip"
rm -rf "$DIST"
mkdir -p "$DIST"
if command -v zip >/dev/null 2>&1; then
  (cd "$MODULE" && zip -q -r -X -D "$OUT" .)
else
  python3 - "$MODULE" "$OUT" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(src):
        for name in sorted(files):
            path = os.path.join(base, name)
            rel = os.path.relpath(path, src).replace(os.sep, "/")
            info = zipfile.ZipInfo.from_file(path, rel)
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(path, "rb") as f:
                z.writestr(info, f.read())
PY
fi
echo "$OUT"
