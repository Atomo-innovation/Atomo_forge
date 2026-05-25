#!/usr/bin/env bash
# Quick checks for "AI process exited (code 1)" on the Electron board.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS="${ASNN_MODELS_DIR:-$ROOT/asnn-dashboard/models}"
AUTH_PORT="${AUTH_PORT:-3003}"

echo "=== ASNN inference diagnostics ==="
echo "Repo: $ROOT"
echo "Models dir: $MODELS"
echo

echo "--- Model folders (.nb + .so required) ---"
ok=0
bad=0
for d in "$MODELS"/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  nb="$(find "$d" -maxdepth 1 -name '*.nb' 2>/dev/null | head -1)"
  so="$(find "$d" -maxdepth 1 -name '*.so' 2>/dev/null | head -1)"
  if [ -n "$nb" ] && [ -n "$so" ]; then
    echo "  OK  $name"
    ok=$((ok + 1))
  else
    echo "  BAD $name  (missing .nb or .so)"
    bad=$((bad + 1))
  fi
done
echo "Valid: $ok  Incomplete: $bad"
echo

echo "--- Python / ASNN ---"
if python3 -c "from asnn.api import asnn" 2>/dev/null; then
  echo "  OK  python3 can import asnn"
else
  echo "  FAIL  asnn Python package not installed (required on board)"
fi
for f in "$ROOT/asnn-dashboard/detect.py" "$ROOT/asnn-dashboard/person.py"; do
  if [ -f "$f" ]; then echo "  OK  $f"; else echo "  MISSING  $f"; fi
done
echo

echo "--- Camera device (USB) ---"
if [ -e /dev/video0 ]; then
  echo "  /dev/video0 exists"
  if command -v fuser >/dev/null 2>&1; then
    if fuser /dev/video0 2>/dev/null; then
      echo "  WARN  /dev/video0 is in use (stop browser preview / other apps):"
      fuser -v /dev/video0 2>/dev/null || true
    else
      echo "  OK  /dev/video0 is free"
    fi
  fi
else
  echo "  WARN  no /dev/video0 (USB camera not detected?)"
fi
echo

echo "--- Auth API ---"
if curl -sf "http://127.0.0.1:${AUTH_PORT}/asnn/api/models" >/dev/null; then
  echo "  OK  GET /asnn/api/models"
  curl -s "http://127.0.0.1:${AUTH_PORT}/asnn/api/models" | head -c 400
  echo
else
  echo "  FAIL  auth-server not responding on port ${AUTH_PORT} (run: npm run dev)"
fi
echo

echo "--- Manual test (person model, 3s) ---"
PERSON_NB="$MODELS/person/person.nb"
PERSON_SO="$MODELS/person/libnn_person.so"
if [ -f "$PERSON_NB" ] && [ -f "$PERSON_SO" ]; then
  echo "  python3 asnn-dashboard/person.py --json-stream --type usb --device 0 ..."
  timeout 3 python3 "$ROOT/asnn-dashboard/person.py" \
    --model "$PERSON_NB" --library "$PERSON_SO" \
    --json-stream --type usb --device 0 --level 0 2>&1 | head -5 || true
else
  echo "  skip (person.nb / libnn_person.so missing)"
fi
echo
echo "Done. If manual test shows 'Cannot open' → free the camera. If 'model not found' → fix paths on board."
