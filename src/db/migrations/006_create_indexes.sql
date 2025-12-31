-- Migration: Create indexes for performance

-- Users indexes
CREATE INDEX idx_users_matrix ON users(matrix_user_id);
CREATE INDEX idx_users_ap ON users(ap_actor_id);
CREATE INDEX idx_users_puppet ON users(is_puppet) WHERE is_puppet = TRUE;
CREATE INDEX idx_users_double_puppet ON users(is_double_puppet) WHERE is_double_puppet = TRUE;

-- Messages indexes
CREATE INDEX idx_messages_matrix ON messages(matrix_event_id);
CREATE INDEX idx_messages_ap ON messages(ap_object_id);
CREATE INDEX idx_messages_room ON messages(room_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_created ON messages(created_at);

-- Rooms indexes
CREATE INDEX idx_rooms_ap_context ON rooms(ap_context_id);
CREATE INDEX idx_rooms_type ON rooms(room_type);

-- Follows indexes
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);
CREATE INDEX idx_follows_status ON follows(status);
CREATE INDEX idx_follows_ap_id ON follows(ap_follow_id);

-- Media indexes
CREATE INDEX idx_media_mxc ON media(matrix_mxc_url);
CREATE INDEX idx_media_ap ON media(ap_media_url);
CREATE INDEX idx_media_created ON media(created_at);
