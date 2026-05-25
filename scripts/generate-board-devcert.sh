#!/usr/bin/env bash
# Regenerate devcert for this machine (localhost + electron.local + LAN IP).
# Safe to re-run on the board after IP changes. No sudo required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVCERT="$ROOT/devcert"
mkdir -p "$DEVCERT"

LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"

CONF="$(mktemp)"
trap 'rm -f "$CONF"' EXIT

cat >"$CONF" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3

[dn]
CN = electron.local

[v3]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = electron.local
IP.1 = 127.0.0.1
EOF

if [[ -n "$LAN_IP" ]]; then
  printf 'IP.2 = %s\n' "$LAN_IP" >>"$CONF"
fi

openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout "$DEVCERT/key.pem" \
  -out "$DEVCERT/cert.pem" \
  -config "$CONF" -extensions v3

chmod 600 "$DEVCERT/key.pem" 2>/dev/null || true

echo "[devcert] $DEVCERT"
echo "[devcert] SAN: localhost, electron.local, 127.0.0.1${LAN_IP:+, $LAN_IP}"
openssl x509 -in "$DEVCERT/cert.pem" -noout -ext subjectAltName 2>/dev/null || true
