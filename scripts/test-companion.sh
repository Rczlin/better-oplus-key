#!/usr/bin/env bash
# 伴生应用的纯 Java 逻辑测试，只需要 JDK（不需要 Android SDK）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/companion-test"
SRC="$ROOT/companion/src/io/github/rczlin/sidekey/island"
rm -rf "$OUT" && mkdir -p "$OUT"
javac -encoding UTF-8 --release 11 -d "$OUT" \
  "$SRC/PressNames.java" "$SRC/PosterArgs.java" \
  "$ROOT/companion/test/PressNamesTest.java" "$ROOT/companion/test/PosterArgsTest.java"
java -Dfile.encoding=UTF-8 -cp "$OUT" PressNamesTest
java -Dfile.encoding=UTF-8 -cp "$OUT" PosterArgsTest
