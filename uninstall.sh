#!/bin/zsh
# Удаление «Паролей» с этого Mac. Файл с паролями в ~/Documents/Пароли НЕ удаляется.
LABEL="com.pswd.server"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/pswd"
echo "Удалено. Файл хранилища остался в ~/Documents/Пароли — удалите его вручную, если нужно."
echo "Значок «Пароли» уберите из Dock сами (перетащите его из Dock)."
