#!/usr/bin/env bash
# Exit 0 only on the edge board (.forge-board from npm run board:setup, or FORGE_BOARD=1).
# Laptop hostname "electron" is NOT treated as the board.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${FORGE_BOARD:-}" == "1" ]]; then
  exit 0
fi

if [[ -f "$ROOT/.forge-board" ]]; then
  exit 0
fi

exit 1
