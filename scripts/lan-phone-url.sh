#!/usr/bin/env bash
# Print the URL that works on phones (IP, not electron.local).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAN="$(node "$ROOT/scripts/forge-network.cjs" 2>/dev/null || true)"

if [[ -z "$LAN" ]]; then
  echo "Could not detect LAN IP. Connect Wi‑Fi and run again." >&2
  exit 1
fi

URL="http://${LAN}/dashboard"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 2 "$URL" 2>/dev/null || echo err)"

echo ""
echo "══════════════════════════════════════════════════"
echo " OPEN ON YOUR PHONE (same Wi‑Fi as this laptop)"
echo "══════════════════════════════════════════════════"
echo ""
echo "  $URL"
echo ""
if [[ "$CODE" == "200" ]]; then
  echo "  Status: OK (npm run dev is running)"
else
  echo "  Status: $CODE — run: npm run dev   (then try again)"
fi
echo ""
echo "  • Type http:// at the start (not https://)"
echo "  • electron.local often fails on Android — use the IP above"
echo "  • Turn off VPN / Private DNS on the phone if it still fails"
echo ""
