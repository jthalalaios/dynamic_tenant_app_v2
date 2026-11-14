-- init.sql
-- Runs once, when the postgres-data volume is created. The app itself connects
-- with POSTGRES_DB_USERNAME (created by the image from the root .env); this adds a
-- separate, optional role with full rights on the app database (e.g. for tooling).

-- Create database if it does not exist
SELECT 'CREATE DATABASE "nodejs-react-app"'
WHERE NOT EXISTS (
    SELECT FROM pg_database
    WHERE datname = 'nodejs-react-app'
)\gexec

-- Create user if it does not exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_roles
        WHERE rolname = 'nodejs-react-app_user'
    ) THEN
        CREATE USER "nodejs-react-app_user"
        WITH PASSWORD '123TestNodeReactUser#321!';
    ELSE
        ALTER USER "nodejs-react-app_user"
        WITH PASSWORD '123TestNodeReactUser#321!';
    END IF;
END
$$;

-- Grant database privileges
GRANT ALL PRIVILEGES ON DATABASE "nodejs-react-app"
TO "nodejs-react-app_user";

-- Connect to database
\connect "nodejs-react-app"

-- Grant schema privileges
GRANT USAGE, CREATE ON SCHEMA public
TO "nodejs-react-app_user";

-- Grant privileges on existing tables
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
TO "nodejs-react-app_user";

-- Grant privileges on existing sequences
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
TO "nodejs-react-app_user";

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL PRIVILEGES ON TABLES
TO "nodejs-react-app_user";

-- Set default privileges for future sequences
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL PRIVILEGES ON SEQUENCES
TO "nodejs-react-app_user";
