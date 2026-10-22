#!/usr/bin/env bash
# Geeken installer. Usage (as root):  bash <(curl -s __BASE_URL__/install.sh)
set -e
BASE_URL="__BASE_URL__"
[ "$(id -u)" -eq 0 ] || { echo "Run this as root (sudo -i)."; exit 1; }
command -v curl >/dev/null || { echo "curl is required."; exit 1; }
curl -fsS "$BASE_URL/geeken" -o /usr/local/bin/geeken
chmod +x /usr/local/bin/geeken
exec /usr/local/bin/geeken menu
