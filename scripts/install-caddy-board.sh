#!/usr/bin/env bash
# Install Caddy on Ubuntu/Debian ARM (e.g. board with focal + ports.ubuntu.com).
# Run as root: sudo bash scripts/install-caddy-board.sh
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

if command -v caddy >/dev/null 2>&1; then
  echo "[caddy] already installed: $(caddy version 2>/dev/null || caddy version)"
  exit 0
fi

echo "[caddy] trying apt package 'caddy'…"
if apt-get install -y caddy 2>/dev/null; then
  command -v caddy >/dev/null 2>&1 && exit 0
fi

echo "[caddy] apt has no caddy — adding official Caddy repository (Cloudsmith)…"
apt-get update -y
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg ca-certificates

if ! curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null; then
  echo "[caddy] Cloudsmith GPG failed — trying setup.deb.sh…" >&2
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/setup.deb.sh' | bash
else
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
fi

apt-get install -y caddy

if ! command -v caddy >/dev/null 2>&1; then
  echo "[caddy] package install failed — downloading arm64 binary…" >&2
  ARCH="$(uname -m)"
  case "$ARCH" in
    aarch64|arm64) CADDY_ARCH=arm64 ;;
    armv7l|armhf) CADDY_ARCH=arm ;;
    x86_64|amd64) CADDY_ARCH=amd64 ;;
    *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
  esac
  VER="2.8.4"
  URL="https://github.com/caddyserver/caddy/releases/download/v${VER}/caddy_${VER}_linux_${CADDY_ARCH}.tar.gz"
  TMP="$(mktemp -d)"
  curl -fsSL "$URL" -o "$TMP/caddy.tgz"
  tar -xzf "$TMP/caddy.tgz" -C "$TMP"
  install -m 755 "$TMP/caddy" /usr/local/bin/caddy
  rm -rf "$TMP"
  mkdir -p /etc/caddy
  cat >/etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=notify
User=root
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile
TimeoutStopSec=5s
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
fi

caddy version
echo "[caddy] install OK"
