-- Initialize databases for Matrix-ActivityPub Bridge
-- This script runs automatically when PostgreSQL container starts for the first time

-- Create Synapse database (bridge database is created by POSTGRES_DB env var)
CREATE DATABASE synapse;

-- Grant privileges to bridge user
GRANT ALL PRIVILEGES ON DATABASE synapse TO bridge;

-- Note: The matrix_ap_bridge database tables are created by the bridge's
-- migration system on first startup. No manual table creation needed here.
