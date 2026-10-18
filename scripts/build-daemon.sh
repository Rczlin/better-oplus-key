#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NDK_PATH="${NDK:-${ANDROID_NDK_HOME:-}}"
if [ ! -f "$NDK_PATH/build/cmake/android.toolchain.cmake" ]; then
  echo "Set NDK or ANDROID_NDK_HOME to an installed Android NDK" >&2
  exit 1
fi
BUILD="$ROOT/build/android-arm64-linux"
cmake -S "$ROOT/daemon" -B "$BUILD" -G Ninja \
  "-DCMAKE_TOOLCHAIN_FILE=$NDK_PATH/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-29 -DCMAKE_BUILD_TYPE=Release
cmake --build "$BUILD" --target oplus-sidekey
mkdir -p "$ROOT/module/bin"
cp "$BUILD/oplus-sidekey" "$ROOT/module/bin/oplus-sidekey"
chmod 0755 "$ROOT/module/bin/oplus-sidekey"
