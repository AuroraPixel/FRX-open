#!/bin/sh
# The game server's own database role for the multi-user deployment (compose.multiuser.yaml).
# The postgres image runs this once, as the owner, when the database volume is first created.
#
# frx_app logs in and reads and writes rows, nothing more: it owns no table, is no superuser
# and cannot bypass row-level security, so it sees only the rows of the user each transaction
# declares. Tables are created later by the owner (the server's schema upgrade, through
# FRX_MIGRATION_URL); the default privileges below hand them to frx_app as they come.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner="$POSTGRES_USER" -v db="$POSTGRES_DB" -v app_password="$FRX_DB_APP_PASSWORD" <<'SQL'
CREATE ROLE frx_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE :"db" TO frx_app;
GRANT USAGE ON SCHEMA public TO frx_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO frx_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO frx_app;
SQL
