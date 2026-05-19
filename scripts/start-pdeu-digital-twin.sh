#!/usr/bin/env bash
# Start PDEU digital twin (Express + WebSockets on TWIN_HTTP_PORT, default 3000). Used by `npm run dev`.
# Folder is resolved dynamically (repo root or any top-level final_*/pdeu_digitaltwin/...) — same as scripts/start-pdeu-digital-twin.cjs.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TWIN_DIR="$(cd "$REPO_ROOT" && node "$REPO_ROOT/scripts/resolve-pdeu-digital-twin-dir.cjs")"
cd "$TWIN_DIR"
node "$REPO_ROOT/scripts/install-pdeu-digital-twin.cjs" || exit $?
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi
export MQTT_DISABLED="${MQTT_DISABLED:-1}"
export DETECTION_SOURCE="${DETECTION_SOURCE:-json}"
exec node server.js
