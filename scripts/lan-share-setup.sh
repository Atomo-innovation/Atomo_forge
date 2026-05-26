#!/usr/bin/env bash
# How to let phones/tablets/other PCs open http://electron.local on the same Wi‑Fi.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAN="$(node "$ROOT/scripts/forge-network.cjs" 2>/dev/null || true)"

mdns=no
if command -v systemctl >/dev/null 2>&1 && systemctl is-active avahi-daemon &>/dev/null 2>&1; then
  mdns=yes
fi
caddy80=no
if ss -tln 2>/dev/null | grep -qE ':80\b'; then
  caddy80=yes
fi

cat <<EOF

══════════════════════════════════════════════════════════
 Share Forge on Wi‑Fi — http://electron.local (not https)
══════════════════════════════════════════════════════════

Other devices need:
  • Same Wi‑Fi as this laptop
  • http://  (not https://)
  • Caddy on port 80 (they cannot use your :8443 Vite port directly)

ONE-TIME on this laptop:
  1. npm run lan:setup       # mDNS: electron.local → this PC
  2. npm run caddy:start     # listen on :80 for the LAN
  3. npm run caddy:sync
  4. If firewall is on:  sudo ufw allow 80/tcp

This laptop only (/etc/hosts, optional):
  echo "127.0.0.1 electron.local" | sudo tee -a /etc/hosts

EVERY TIME you share:
  npm run dev                # keep this terminal open

ON YOUR PHONE (same Wi‑Fi) — use the IP, not electron.local:
  http://${LAN:-<your-LAN-IP>}/dashboard

  Run anytime: npm run lan:phone

  WHY IP works but electron.local does not on phones:
  Android Chrome does not resolve .local (mDNS) in the address bar.
  That is a phone/OS limit, not a bug in Forge.

  TO USE electron.local ON A PHONE (optional):
    npm run lan:dns
    Then on phone Wi‑Fi → DNS manual → ${LAN:-<LAN-IP>}
    Open http://electron.local/dashboard
    (Set DNS back to Automatic when done.)

ON OTHER PCs (may try mDNS first):
  http://electron.local/dashboard
  http://${LAN:-<your-LAN-IP>}/dashboard

Status on this machine:
  mDNS (Avahi):     ${mdns}
  Caddy port 80:    ${caddy80}
  Your LAN IP:      ${LAN:-unknown}

EOF

if [[ "$mdns" != "yes" ]]; then
  echo "→ Run: npm run lan:setup"
fi
if [[ "$caddy80" != "yes" ]]; then
  echo "→ Run: npm run caddy:start && npm run caddy:sync"
fi
echo ""
