#!/bin/sh
set -eu

job="${1:-}"
base="${APP_URL:-http://web:3000}"
base="${base%/}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is required" >&2
  exit 1
fi

case "$job" in
  airtable) path="/api/cron/airtable-reconcile" ;;
  shopify) path="/api/cron/shopify-sync" ;;
  *)
    echo "Usage: run-sync-jobs.sh airtable|shopify" >&2
    exit 1
    ;;
esac

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $job"
curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 900 \
  --retry 2 \
  --retry-delay 5 \
  "${base}${path}"
echo
