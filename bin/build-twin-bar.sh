#!/bin/bash
# Build TwinBar.app — twin's menu bar companion — and install its login agent.
#
#   bin/build-twin-bar.sh            build + (re)install + (re)launch
#   bin/build-twin-bar.sh --no-load  build only, don't touch launchd
#
# Produces bin/TwinBar.app (ad-hoc signed, LSUIElement) and loads
# ~/Library/LaunchAgents/com.twin.bar.plist (RunAtLoad + KeepAlive).
set -euo pipefail

HERE="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/twin-bar.swift"
APP="$HERE/TwinBar.app"
BIN="$APP/Contents/MacOS/TwinBar"
PLIST="$HOME/Library/LaunchAgents/com.twin.bar.plist"
LABEL="com.twin.bar"

echo "▸ compiling twin-bar.swift…"
mkdir -p "$APP/Contents/MacOS"

# Swift 5 mode keeps the single-file SwiftUI app free of strict-concurrency noise.
swiftc -O -swift-version 5 -parse-as-library \
  -target arm64-apple-macos14.0 \
  -framework SwiftUI -framework AppKit -framework AVFoundation -framework Speech \
  -o "$BIN" "$SRC"

echo "▸ writing Info.plist…"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>TwinBar</string>
  <key>CFBundleDisplayName</key><string>twin</string>
  <key>CFBundleIdentifier</key><string>com.twin.bar</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>TwinBar</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <!-- Agent app: lives only in the menu bar, never the Dock or app switcher. -->
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>twin records voice notes from the menu bar and saves them to your inbox.</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>twin transcribes your voice notes on-device so they become searchable text.</string>
</dict>
</plist>
PLIST

echo "▸ ad-hoc signing…"
codesign --force --sign - --timestamp=none "$APP" >/dev/null 2>&1 || \
  codesign --force --sign - "$APP"

if [[ "${1:-}" == "--no-load" ]]; then
  echo "✓ built $APP (not loaded)"; exit 0
fi

echo "▸ installing login agent…"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-W</string>
    <string>$APP</string>
  </array>
  <!-- RunAtLoad brings the menu bar item back after every login/boot. -->
  <key>RunAtLoad</key><true/>
  <!-- KeepAlive relaunches it if it crashes or is quit. -->
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HERE/../reports/twinbar.log</string>
  <key>StandardErrorPath</key><string>$HERE/../reports/twinbar.err.log</string>
</dict>
</plist>
PLIST

UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
# Kill any stray instance so the fresh build takes over the menu bar slot.
pkill -f "TwinBar.app/Contents/MacOS/TwinBar" 2>/dev/null || true
sleep 0.5
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl kickstart -k "gui/$UID_NUM/$LABEL" 2>/dev/null || true

echo "✓ TwinBar built, signed, and running in the menu bar."
