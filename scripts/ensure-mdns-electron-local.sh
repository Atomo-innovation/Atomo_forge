#!/usr/bin/env bash
# Enable http://electron.local on other devices (mDNS / Avahi). No sudo unless starting the daemon fails.
set -euo pipefail

log() { printf '[forge] %s\n' "$*"; }

mdns_active() {
  command -v systemctl >/dev/null 2>&1 && systemctl is-active avahi-daemon &>/dev/null 2>&1
}

try_start_avahi() {
  command -v systemctl >/dev/null 2>&1 || return 1
  if systemctl start avahi-daemon 2>/dev/null; then
    sleep 1
    mdns_active && return 0
  fi
  return 1
}

if mdns_active; then
  export FORGE_MDNS_ACTIVE=1
  export FORGE_OTHER_DEVICES_URL="http://electron.local"
  export VITE_OTHER_DEVICES_URL="http://electron.local"
  exit 0
fi

if try_start_avahi; then
  log 'Started avahi-daemon → other devices can use http://electron.local'
  export FORGE_MDNS_ACTIVE=1
  export FORGE_OTHER_DEVICES_URL="http://electron.local"
  export VITE_OTHER_DEVICES_URL="http://electron.local"
  exit 0
fi

log 'mDNS not active — other devices cannot resolve electron.local yet.'
log 'One-time on this PC: npm run lan:setup   (installs Avahi, publishes electron.local)'
export FORGE_MDNS_ACTIVE=0
