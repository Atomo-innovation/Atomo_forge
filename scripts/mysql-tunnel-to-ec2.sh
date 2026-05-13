#!/usr/bin/env bash
# Forward local TCP -> MySQL on EC2 (MySQL bound to 127.0.0.1 on the server only).
#
# Auto-started by `npm run dev`. Reads .env for:
#   FORGE_EC2_HOST          (default: 65.2.142.160)
#   FORGE_EC2_USER          (default: ubuntu)
#   FORGE_EC2_SSH_KEY       (path to .pem; required)
#   FORGE_MYSQL_LOCAL_PORT  (default: 3307; must match MYSQL_PORT in .env)
#
# Behavior:
#   • If something already listens on FORGE_MYSQL_LOCAL_PORT, reuse it and sleep.
#   • Otherwise, run ssh -N and auto-reconnect on disconnect.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

# Load .env (so FORGE_* vars are picked up without an extra `export` step).
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

FORGE_EC2_HOST="${FORGE_EC2_HOST:-65.2.142.160}"
FORGE_EC2_USER="${FORGE_EC2_USER:-ubuntu}"
FORGE_MYSQL_LOCAL_PORT="${FORGE_MYSQL_LOCAL_PORT:-3307}"

# Expand ~ / $HOME in the configured key path (in case .env wasn't sourced
# through bash, e.g. when called by a Node process).
if [[ -n "${FORGE_EC2_SSH_KEY:-}" ]]; then
  FORGE_EC2_SSH_KEY="${FORGE_EC2_SSH_KEY/#\~/$HOME}"
  # Manually expand a literal "$HOME" / "${HOME}" prefix if it survived.
  FORGE_EC2_SSH_KEY="${FORGE_EC2_SSH_KEY//\$HOME/$HOME}"
  FORGE_EC2_SSH_KEY="${FORGE_EC2_SSH_KEY//\$\{HOME\}/$HOME}"
fi

# If the configured key doesn't exist (or wasn't set), auto-discover one in
# common locations. Order: explicit-named atomo_web.pem first, then any *.pem
# in ~/Downloads, then any *.pem in ~/.ssh.
if [[ -z "${FORGE_EC2_SSH_KEY:-}" || ! -f "${FORGE_EC2_SSH_KEY}" ]]; then
  if [[ -n "${FORGE_EC2_SSH_KEY:-}" && ! -f "${FORGE_EC2_SSH_KEY}" ]]; then
    echo "[tunnel] note: configured key not found at: ${FORGE_EC2_SSH_KEY}" >&2
    echo "[tunnel] looking in standard locations..." >&2
  fi
  CANDIDATES=(
    "$HOME/atomo_web.pem"
    "$HOME/Downloads/atomo_web.pem"
    "$HOME/.ssh/atomo_web.pem"
    "$HOME"/atomo_web*.pem
    "$HOME/Downloads"/*.pem
    "$HOME/.ssh"/*.pem
    "$HOME"/*.pem
  )
  for cand in "${CANDIDATES[@]}"; do
    if [[ -f "$cand" ]]; then
      FORGE_EC2_SSH_KEY="$cand"
      echo "[tunnel] auto-discovered key: $FORGE_EC2_SSH_KEY" >&2
      break
    fi
  done
fi

if [[ -z "${FORGE_EC2_SSH_KEY:-}" || ! -f "${FORGE_EC2_SSH_KEY}" ]]; then
  echo "[tunnel] No SSH key found." >&2
  echo "[tunnel] Drop your EC2 .pem at any of these paths and retry:" >&2
  echo "[tunnel]   $HOME/atomo_web.pem" >&2
  echo "[tunnel]   $HOME/Downloads/atomo_web.pem   (recommended)" >&2
  echo "[tunnel]   $HOME/.ssh/atomo_web.pem" >&2
  echo "[tunnel] Or set FORGE_EC2_SSH_KEY in .env to the absolute path of the key." >&2
  echo "[tunnel] Existing .pem files:" >&2
  ls -la "$HOME"/*.pem 2>/dev/null >&2 || true
  ls -la "$HOME/Downloads"/*.pem 2>/dev/null >&2 || true
  ls -la "$HOME/.ssh"/*.pem 2>/dev/null >&2 || true
  exit 1
fi
# Ensure key perms are tight; ssh refuses world-readable keys.
chmod 600 "$FORGE_EC2_SSH_KEY" 2>/dev/null || true

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "(^|:)${FORGE_MYSQL_LOCAL_PORT}$" -q
  else
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -E "(^|:)${FORGE_MYSQL_LOCAL_PORT}$" -q
  fi
}

if port_in_use; then
  echo "[tunnel] Port ${FORGE_MYSQL_LOCAL_PORT} already in use — reusing existing tunnel."
  echo "[tunnel] Sleeping to keep concurrently happy. Ctrl+C to stop."
  # Sleep forever (or until killed by `npm run dev`).
  while sleep 3600; do :; done
fi

echo "[tunnel] localhost:${FORGE_MYSQL_LOCAL_PORT} -> ${FORGE_EC2_USER}@${FORGE_EC2_HOST}:127.0.0.1:3306"
echo "[tunnel] key: ${FORGE_EC2_SSH_KEY}"

# Auto-reconnect loop. Brief backoff so a flaky network doesn't spam logs.
attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "[tunnel] starting ssh (attempt ${attempt})"
  ssh -N \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=accept-new \
    -o ExitOnForwardFailure=yes \
    -L "${FORGE_MYSQL_LOCAL_PORT}:127.0.0.1:3306" \
    -i "$FORGE_EC2_SSH_KEY" \
    "${FORGE_EC2_USER}@${FORGE_EC2_HOST}" || true
  echo "[tunnel] ssh exited; reconnecting in 3s"
  sleep 3
done
