#!/usr/bin/env bash
# Why electron.local works on PC but not on phone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAN="$(node "$ROOT/scripts/forge-network.cjs" 2>/dev/null || true)"

echo "=== electron.local on the LAN ==="
echo ""
echo "LAN IP (always works on phone):  http://${LAN:-?}/dashboard"
echo ""

if systemctl is-active avahi-daemon &>/dev/null 2>&1; then
  echo "Avahi (mDNS): running"
else
  echo "Avahi (mDNS): NOT running — run: npm run lan:setup"
fi

echo "Hostname: $(hostname -s 2>/dev/null || hostname)"
if [[ -f /etc/avahi/avahi-daemon.d/forge-host.conf ]]; then
  echo "Avahi host config: installed"
else
  echo "Avahi host config: missing — run: npm run lan:setup"
fi

echo ""
echo "This laptop resolves electron.local as:"
getent ahostsv4 electron.local 2>/dev/null | awk '{print "  ", $1}' || echo "  (not found)"

echo ""
echo "--- Why phones often fail ---"
echo "  • Android Chrome usually does NOT resolve .local names (mDNS) in the URL bar."
echo "  • iPhone: sometimes works; turn off iCloud Private Relay / VPN."
echo "  • PCs on same Wi‑Fi: often work after npm run lan:setup."
echo ""
echo "--- Make electron.local work ON THE PHONE ---"
echo "  A) Use IP (easiest):  http://${LAN:-<LAN-IP>}/dashboard"
echo "  B) Phone DNS → laptop: npm run lan:dns  (then set phone Wi‑Fi DNS to ${LAN:-<LAN-IP>})"
echo "  C) Router: add local DNS  electron.local → ${LAN:-<LAN-IP>}"
echo ""

if command -v avahi-browse >/dev/null 2>&1; then
  echo "--- mDNS browse (5s) ---"
  timeout 5 avahi-browse -rt _workstation._tcp 2>/dev/null | grep -i electron || echo "  (no workstation advertisement seen from this host)"
fi
