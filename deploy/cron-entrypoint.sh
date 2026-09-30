#!/bin/sh
set -eu

if [ -z "${CRON_SECRET:-}" ] || [ -z "${APP_URL:-}" ]; then
  echo "CRON_SECRET and APP_URL are required" >&2
  exit 1
fi

umask 077
printf "APP_URL='%s'\nCRON_SECRET='%s'\n" "$APP_URL" "$CRON_SECRET" > /etc/cron.env

attempt=0
until curl -fsS "${APP_URL%/}/api/health" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "App health check did not succeed; starting the schedule anyway" >&2
    break
  fi
  sleep 2
done

exec crond -f -l 8
