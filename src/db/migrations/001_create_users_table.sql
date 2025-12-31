-- Migration: Create users table
-- User mappings between Matrix and ActivityPub

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matrix_user_id TEXT UNIQUE,
    ap_actor_id TEXT UNIQUE,
    ap_inbox_url TEXT,
    ap_shared_inbox_url TEXT,
    display_name TEXT,
    avatar_url TEXT,
    is_puppet BOOLEAN DEFAULT FALSE,
    is_double_puppet BOOLEAN DEFAULT FALSE,
    access_token_encrypted BYTEA,
    private_key_pem TEXT,
    public_key_pem TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
