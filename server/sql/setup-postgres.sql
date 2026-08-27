-- Flotilla — one-time database setup
--
-- Creates a dedicated database and a dedicated login role, following the same
-- single-responsibility pattern as the existing `lotsmith` database. Flotilla
-- gets rights to its own database and nothing else, so a leaked Flotilla
-- credential cannot touch directjobsource_db or lotsmith.
--
-- Run as a superuser (the `postgres` role), connected to the `postgres`
-- database. In pgAdmin: right-click the server -> Query Tool.
--
-- IMPORTANT: run PART 1 and PART 2 separately. CREATE DATABASE cannot run
-- inside a transaction block, and PART 2 must be executed while connected to
-- the new `flotilla` database, not to `postgres`.

-- ===========================================================================
-- PART 1 — run while connected to the `postgres` database
-- ===========================================================================

-- Generate a strong password first and keep it in your password manager:
--   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
-- Then replace REPLACE_WITH_STRONG_PASSWORD below. Do not commit this file
-- with a real password in it.

CREATE ROLE flotilla_app WITH
  LOGIN
  PASSWORD 'REPLACE_WITH_STRONG_PASSWORD'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  CONNECTION LIMIT 10;   -- one app with a pool of 5; leaves headroom, caps runaway

COMMENT ON ROLE flotilla_app IS 'Application role for Flotilla. Owns the flotilla database only.';

CREATE DATABASE flotilla
  OWNER flotilla_app
  ENCODING 'UTF8';

COMMENT ON DATABASE flotilla IS 'Flotilla — Google Analytics dashboard.';

-- No other role should reach this database by default.
REVOKE ALL ON DATABASE flotilla FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE flotilla TO flotilla_app;

-- Make sure the new role cannot wander into the neighbours. These are no-ops
-- if PUBLIC was already revoked, and harmless to run twice.
REVOKE ALL ON DATABASE postgres FROM flotilla_app;
REVOKE ALL ON DATABASE lotsmith FROM flotilla_app;
REVOKE ALL ON DATABASE directjobsource_db FROM flotilla_app;


-- ===========================================================================
-- PART 2 — reconnect to the `flotilla` database, then run this
-- ===========================================================================
-- In pgAdmin: expand Databases -> right-click `flotilla` -> Query Tool.

-- The application creates its own tables on first start, so it needs ownership
-- of the schema it will use. Postgres 15+ already removes CREATE from PUBLIC;
-- these statements make that explicit and are safe on older versions too.
ALTER SCHEMA public OWNER TO flotilla_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO flotilla_app;


-- ===========================================================================
-- VERIFY — run either part; both should look like the comments describe
-- ===========================================================================

-- The role exists and is deliberately unprivileged:
--   rolsuper, rolcreatedb, rolcreaterole should all be false
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolconnlimit
FROM pg_roles
WHERE rolname = 'flotilla_app';

-- The database exists and is owned by that role:
SELECT d.datname, pg_catalog.pg_get_userbyid(d.datdba) AS owner, d.datacl
FROM pg_database d
WHERE d.datname = 'flotilla';

-- Connected to `flotilla`, the public schema should be owned by flotilla_app:
-- SELECT nspname, pg_catalog.pg_get_userbyid(nspowner) AS owner
-- FROM pg_namespace WHERE nspname = 'public';


-- ===========================================================================
-- Connection string for the application
-- ===========================================================================
-- postgresql://flotilla_app:<password>@<host>:<port>/flotilla
--
-- Set it as DATABASE_URL. Also set:
--   DATABASE_SCHEMA=public   (a dedicated database needs no extra schema)
--   DATABASE_SSL=1           (any connection crossing a network)
--
-- Flotilla creates its own tables on first start; there is no migration to run.


-- ===========================================================================
-- Undo, if you ever need it. Destroys all Flotilla data.
-- ===========================================================================
-- DROP DATABASE IF EXISTS flotilla;
-- DROP ROLE IF EXISTS flotilla_app;
