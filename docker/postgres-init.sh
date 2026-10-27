#!/bin/sh
set -eu

# Keep the role/schema grants aligned with tests/pg_harness.py (T2a).
owner_password="$(cat /run/postgres/owner-password)"
app_password="$(cat /run/postgres/app-password)"
for value in "$owner_password" "$app_password"; do
  case "$value" in ''|*[!a-f0-9]*) echo 'Invalid generated credential (hex expected)' >&2; exit 1;; esac
done
case "$POSTGRES_DB" in ''|*[!a-z0-9_]*) echo 'Invalid database identifier' >&2; exit 1;; esac
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<SQL
CREATE ROLE ontotator_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$owner_password';
CREATE ROLE ontotator_app   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$app_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE "$POSTGRES_DB" FROM PUBLIC;
GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO ontotator_owner, ontotator_app;
CREATE SCHEMA ontotator AUTHORIZATION ontotator_owner;
GRANT USAGE ON SCHEMA ontotator TO ontotator_app;
SQL
