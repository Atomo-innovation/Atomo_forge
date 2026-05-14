#!/usr/bin/env bash
# Start PDEU digital twin (Express + WebSockets on TWIN_HTTP_PORT, default 3000). Used by `npm run dev`.
# Folder may be `pdeu_digitaltwin` or `pdeu_digitaltwin ` (trailing space) depending on checkout.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TWIN_DIR=""
for cand in "$REPO_ROOT/pdeu_digitaltwin " "$REPO_ROOT/pdeu_digitaltwin"; do
  if [[ -f "$cand/server.js" ]]; then
    TWIN_DIR="$cand"
    break
  fi
done
if [[ -z "$TWIN_DIR" ]]; then
  echo "[twin] server.js not found under $REPO_ROOT/pdeu_digitaltwin or .../pdeu_digitaltwin " >&2
  exit 1
fi
cd "$TWIN_DIR"
node "$REPO_ROOT/scripts/install-pdeu-digital-twin.cjs" || exit $?
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi
export MQTT_DISABLED="${MQTT_DISABLED:-1}"
exec node server.js
