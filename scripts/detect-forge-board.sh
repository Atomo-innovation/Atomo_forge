#!/usr/bin/env bash
# Exit 0 if this machine looks like the edge board (hostname electron or .forge-board).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${FORGE_BOARD:-}" == "1" ]]; then
  exit 0
fi

if [[ -f "$ROOT/.forge-board" ]]; then
  exit 0
fi

SHORT="$(hostname -s 2>/dev/null || hostname 2>/dev/null || true)"
if [[ "$SHORT" == "electron" ]]; then
  exit 0
fi

exit 1
