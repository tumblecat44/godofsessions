#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <path-to-dmg>" >&2
  exit 2
fi

dmg_path=$1
mount_dir=$(mktemp -d /tmp/god-of-sessions-icon-check.XXXXXX)

cleanup() {
  hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
  rmdir "$mount_dir" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg_path" >/dev/null

app_path="$mount_dir/God of Sessions.app"
plist_path="$app_path/Contents/Info.plist"
icon_name=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIconFile" "$plist_path" 2>/dev/null || true)

if [ -z "$icon_name" ]; then
  echo "FAIL: CFBundleIconFile is missing from the app bundle" >&2
  exit 1
fi

icon_path="$app_path/Contents/Resources/$icon_name"

if [ ! -s "$icon_path" ]; then
  echo "FAIL: bundled icon is missing or empty: $icon_path" >&2
  exit 1
fi

echo "PASS: app bundle declares and includes $icon_name"
