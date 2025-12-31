-- Migration: Create media table
-- Media cache for bridged media files

CREATE TABLE media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matrix_mxc_url TEXT,
    ap_media_url TEXT,
    mime_type TEXT,
    file_size BIGINT,
    blurhash TEXT,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    alt_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
