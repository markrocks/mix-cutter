#!/usr/bin/env bash
# Creates "Mix Cutter.app": a small launcher with the Mix Cutter icon.
# Clicking it starts the Mix Cutter server in the background (if it isn't
# already running) and opens the app in your default browser.
#
# Usage: npm run install-app            (installs to /Applications, or ~/Applications)
#        bash scripts/install-mac.sh <folder>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ $# -gt 0 ]; then DEST="$1"
elif [ -w /Applications ]; then DEST=/Applications
else DEST="$HOME/Applications"
fi
APP="$DEST/Mix Cutter.app"

mkdir -p "$DEST"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/assets/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Mix Cutter</string>
  <key>CFBundleDisplayName</key><string>Mix Cutter</string>
  <key>CFBundleIdentifier</key><string>com.markrocks.mixcutter</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# The launcher. ROOT is baked in so the app works from anywhere.
cat > "$APP/Contents/MacOS/launcher" <<LAUNCHER
#!/bin/bash
ROOT="$ROOT"
LAUNCHER
cat >> "$APP/Contents/MacOS/launcher" <<'LAUNCHER'
# Apps opened from Finder don't get your shell's PATH, so add the usual places.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

PORT=$(grep -E '^PORT=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]"'"'")
URL="http://localhost:${PORT:-4317}"
LOG="$HOME/Library/Logs/Mix Cutter.log"

alert() { osascript -e "display alert \"Mix Cutter\" message \"$1\" as critical" >/dev/null 2>&1; }
running() { curl -fs -m 1 "$URL/api/info" >/dev/null 2>&1; }

if ! running; then
  if [ ! -f "$ROOT/server/index.js" ]; then
    alert "Can't find Mix Cutter at $ROOT. If you moved the folder, run 'npm run install-app' again from its new location."
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    alert "Node.js isn't installed. Install it from nodejs.org (or 'brew install node'), then try again."
    exit 1
  fi
  if ! command -v ffmpeg >/dev/null 2>&1; then
    alert "ffmpeg isn't installed. Install it with 'brew install ffmpeg', then try again."
    exit 1
  fi
  cd "$ROOT"
  [ -d node_modules ] || npm install >>"$LOG" 2>&1
  echo "--- $(date) starting Mix Cutter" >>"$LOG"
  nohup node server/index.js >>"$LOG" 2>&1 &
  for _ in $(seq 1 60); do running && break; sleep 0.25; done
  if ! running; then
    alert "Mix Cutter didn't start. Details are in ~/Library/Logs/Mix Cutter.log"
    open -a Console "$LOG"
    exit 1
  fi
fi

open "$URL"
LAUNCHER
chmod +x "$APP/Contents/MacOS/launcher"

# Refresh Finder / Dock / Spotlight so the icon shows up right away.
touch "$APP"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$LSREG" ] && "$LSREG" -f "$APP" >/dev/null 2>&1 || true

echo "Installed: $APP"
echo "Open it from Launchpad, Spotlight (Cmd+Space, \"Mix Cutter\"), or Finder > Applications."
echo "Tip: once it's open, right-click its Dock icon > Options > Keep in Dock."
