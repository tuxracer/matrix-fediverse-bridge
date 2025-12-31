-- Migration: Create messages table
-- Message ID mappings for replies and edits

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matrix_event_id TEXT UNIQUE,
    ap_object_id TEXT UNIQUE,
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
