-- Rollback: Drop indexes

-- Users indexes
DROP INDEX IF EXISTS idx_users_matrix;
DROP INDEX IF EXISTS idx_users_ap;
DROP INDEX IF EXISTS idx_users_puppet;
DROP INDEX IF EXISTS idx_users_double_puppet;

-- Messages indexes
DROP INDEX IF EXISTS idx_messages_matrix;
DROP INDEX IF EXISTS idx_messages_ap;
DROP INDEX IF EXISTS idx_messages_room;
DROP INDEX IF EXISTS idx_messages_sender;
DROP INDEX IF EXISTS idx_messages_created;

-- Rooms indexes
DROP INDEX IF EXISTS idx_rooms_ap_context;
DROP INDEX IF EXISTS idx_rooms_type;

-- Follows indexes
DROP INDEX IF EXISTS idx_follows_follower;
DROP INDEX IF EXISTS idx_follows_following;
DROP INDEX IF EXISTS idx_follows_status;
DROP INDEX IF EXISTS idx_follows_ap_id;

-- Media indexes
DROP INDEX IF EXISTS idx_media_mxc;
DROP INDEX IF EXISTS idx_media_ap;
DROP INDEX IF EXISTS idx_media_created;
