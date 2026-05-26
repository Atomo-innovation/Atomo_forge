#!/usr/bin/env bash
# Board alias for caddy:sync (keeps npm run board:caddy-sync working).
exec bash "$(dirname "$0")/caddy-sync.sh"
