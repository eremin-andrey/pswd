#!/bin/zsh
# Установка «Паролей» на этот Mac: копирует программу и включает автозапуск сервера.
set -euo pipefail

SRC="${0:A:h}"
DEST="$HOME/Library/Application Support/pswd"
PLIST="$HOME/Library/LaunchAgents/com.pswd.server.plist"
LABEL="com.pswd.server"
PORT=8765

mkdir -p "$DEST" "$HOME/Library/LaunchAgents" "$HOME/Documents/Пароли"
cp "$SRC"/{index.html,app.js,crypto.js,style.css,sw.js,manifest.json,server.py,icon-180.png,icon-192.png,icon-512.png} "$DEST/"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$DEST/server.py</string>
    <string>--port</string><string>$PORT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$DEST/server.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Готово: http://localhost:$PORT"
