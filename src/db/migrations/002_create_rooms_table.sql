-- Migration: Create rooms table
-- Room/conversation mappings between Matrix and ActivityPub

CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matrix_room_id TEXT UNIQUE NOT NULL,
    ap_context_id TEXT,
    room_type TEXT CHECK (room_type IN ('dm', 'group', 'public')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
