#!/usr/bin/env bash
# 构建流体云提示伴生应用：module/companion/island.apk（无 Gradle）。
# 需要 $ANDROID_HOME 下的 platforms;android-36 与 build-tools;36.0.0，以及 JDK 17+。
# 签名：设置 SIDEKEY_KEYSTORE / SIDEKEY_KEYSTORE_PASS / SIDEKEY_KEY_ALIAS 时使用该密钥；
# 否则使用 build/companion/debug.keystore（不存在时生成）。伴生应用无状态，签名变化时 island.sh 会卸载重装。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
PLATFORM="${SIDEKEY_PLATFORM:-android-36}"
BUILD_TOOLS="${SIDEKEY_BUILD_TOOLS:-36.0.0}"
JAR="$SDK/platforms/$PLATFORM/android.jar"
BT="$SDK/build-tools/$BUILD_TOOLS"
AAPT2="${AAPT2:-$BT/aapt2}"
ZIPALIGN="${ZIPALIGN:-$BT/zipalign}"
D8="${D8:-$BT/d8}"
APKSIGNER="${APKSIGNER:-$BT/apksigner}"
[ -f "$JAR" ] || { echo "missing $JAR (sdkmanager \"platforms;$PLATFORM\")" >&2; exit 1; }
[ -e "$D8" ] || { echo "missing build-tools $BUILD_TOOLS (sdkmanager \"build-tools;$BUILD_TOOLS\")" >&2; exit 1; }

SRC="$ROOT/companion"
OUT="$ROOT/build/companion"
VERSION=$(sed -n 's/^version=//p' "$ROOT/module/module.prop")
CODE=$(sed -n 's/^versionCode=//p' "$ROOT/module/module.prop")
rm -rf "$OUT/res" "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT"/*.apk
mkdir -p "$OUT/res" "$OUT/gen" "$OUT/classes" "$OUT/dex"

"$AAPT2" compile --dir "$SRC/res" -o "$OUT/res/compiled.zip"
"$AAPT2" link -I "$JAR" --manifest "$SRC/AndroidManifest.xml" \
  --min-sdk-version 36 --target-sdk-version 36 \
  --version-code "$CODE" --version-name "$VERSION" \
  --java "$OUT/gen" -o "$OUT/unsigned.apk" "$OUT/res/compiled.zip"

find "$SRC/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -encoding UTF-8 --release 11 -nowarn -classpath "$JAR" -d "$OUT/classes" @"$OUT/sources.txt"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$D8" --release --min-api 36 --lib "$JAR" --output "$OUT/dex" @"$OUT/classes.txt"
(cd "$OUT/dex" && zip -q -X "$OUT/unsigned.apk" classes.dex)

"$ZIPALIGN" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

KEYSTORE="${SIDEKEY_KEYSTORE:-$OUT/debug.keystore}"
PASS="${SIDEKEY_KEYSTORE_PASS:-android}"
ALIAS="${SIDEKEY_KEY_ALIAS:-sidekey}"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$PASS" -keypass "$PASS" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=oplus-sidekey" >/dev/null 2>&1
fi
mkdir -p "$ROOT/module/companion"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass "pass:$PASS" --key-pass "pass:$PASS" --ks-key-alias "$ALIAS" \
  --out "$ROOT/module/companion/island.apk" "$OUT/aligned.apk"
rm -f "$ROOT/module/companion/island.apk.idsig"
"$APKSIGNER" verify "$ROOT/module/companion/island.apk"
echo "$ROOT/module/companion/island.apk"
