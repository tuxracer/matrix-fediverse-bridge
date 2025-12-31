-- Migration: Create blocks table
-- User and instance blocks for moderation

CREATE TABLE IF NOT EXISTS blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id UUID REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    blocked_instance TEXT,
    block_type TEXT CHECK (block_type IN ('user', 'instance')) NOT NULL,
    reason TEXT,
    ap_block_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(blocker_id, blocked_user_id),
    UNIQUE(blocker_id, blocked_instance)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_instance ON blocks(blocked_instance);
CREATE INDEX IF NOT EXISTS idx_blocks_type ON blocks(block_type);
