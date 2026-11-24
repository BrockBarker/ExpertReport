#!/bin/bash
# Builds "Expert Report.app" into ExpertReport/build. Run from anywhere:  ExpertReport/mac/build.sh
# Set SIGN_ID to use a different signing identity.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 dev/make-seed.py >/dev/null
APP="build/Expert Report.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
swiftc -swift-version 5 -O -o "$APP/Contents/MacOS/ExpertReport" mac/main.swift -framework Cocoa -framework WebKit 2>&1 | grep -v -E "warning:|^\s*$|^\s+[|^~]|^ *[0-9]+ \|" || true
test -x "$APP/Contents/MacOS/ExpertReport"
cp mac/Info.plist "$APP/Contents/Info.plist"
cp -R app/ "$APP/Contents/Resources/web/"
if [ ! -f mac/AppIcon.icns ] || [ mac/icon.svg -nt mac/AppIcon.icns ]; then
  T="$(mktemp -d)"; mkdir "$T/AppIcon.iconset"
  qlmanage -t -s 1024 -o "$T" mac/icon.svg >/dev/null 2>&1
  for s in 16 32 128 256 512; do
    sips -z $s $s "$T/icon.svg.png" --out "$T/AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$T/icon.svg.png" --out "$T/AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$T/AppIcon.iconset" -o mac/AppIcon.icns; rm -rf "$T"
fi
cp mac/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
# Sign with the developer identity when it works without asking, so macOS keeps the app's folder permissions from one build to the next.
# Otherwise sign ad hoc, which runs fine but may ask for folder access again after each rebuild.
ID="${SIGN_ID:-8DA20E2F23DC95D3E41FDE3CC6F310722D13672E}"
python3 - "$ID" "$APP" <<'PY' || codesign --force --sign - "$APP" >/dev/null 2>&1
import subprocess, sys
try:
    sys.exit(subprocess.run(['codesign', '--force', '--sign', sys.argv[1], sys.argv[2]], capture_output=True, timeout=25).returncode)
except subprocess.TimeoutExpired:
    sys.exit(1)
PY
echo "Built $APP"
