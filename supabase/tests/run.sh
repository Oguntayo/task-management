#!/usr/bin/env bash
# Spins up a throwaway PG16, applies migrations, runs rls_tests.sql
set -euo pipefail
BIN=/usr/lib/postgresql/16/bin; D=/tmp/pg/data; P=54329
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../migrations"
if [ "$(id -u)" = 0 ]; then RUN="runuser -u postgres --"; chown -R postgres /tmp/pg 2>/dev/null || true; else RUN=""; fi
$RUN $BIN/pg_ctl -D $D stop -m immediate >/dev/null 2>&1 || true
rm -rf $D; $RUN $BIN/initdb -D $D -U postgres -A trust >/dev/null
$RUN $BIN/pg_ctl -D $D -o "-p $P -k /tmp/pg" -l /tmp/pg/log -w start >/dev/null
PSQL="psql -h /tmp/pg -p $P -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database wl" postgres; PSQL="$PSQL -d wl"
$PSQL -f "$HERE/00_supabase_mock.sql"
for f in "$MIG"/*.sql; do echo "applying $(basename $f)"; $PSQL -f "$f"; done
$PSQL -f "$HERE/rls_tests.sql" 2>&1 | grep -v '^$' || true
$RUN $BIN/pg_ctl -D $D stop -m fast >/dev/null
