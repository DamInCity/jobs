#!/usr/bin/env bash
# Import JobsHub workflow JSON into the jobs_n8n container.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${N8N_CONTAINER:-jobs_n8n}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER is not running. Start with: docker compose up -d n8n"
  exit 1
fi

# Wait for n8n to be ready
for i in $(seq 1 60); do
  if docker exec "$CONTAINER" wget -q -O /dev/null http://127.0.0.1:5678/healthz 2>/dev/null \
    || docker exec "$CONTAINER" wget -q -O /dev/null http://127.0.0.1:5678/ 2>/dev/null; then
    break
  fi
  sleep 2
done

import_one() {
  local file="$1"
  local base
  base="$(basename "$file")"
  echo "Importing $base ..."
  docker cp "$file" "$CONTAINER:/tmp/$base"
  # n8n CLI import (v1+)
  if docker exec -u node "$CONTAINER" n8n import:workflow --input="/tmp/$base" 2>&1; then
    echo "  OK: $base"
  else
    echo "  WARN: CLI import failed for $base — import manually from UI (Workflows → Import)"
    return 1
  fi
}

ok=0
fail=0
for f in "$ROOT"/docs/n8n/*.workflow.json; do
  if import_one "$f"; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
  fi
done

echo "Done. imported=$ok failed=$fail"
echo "Set in n8n env (already passed via compose): JOBSHUB_URL, JOBSHUB_INGEST_KEY"
echo "UI: http://127.0.0.1:${N8N_HOST_PORT:-5678} (SSH tunnel if remote)"
exit 0
