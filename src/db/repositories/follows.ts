import { query } from '../index.js';
import { dbLogger } from '../../utils/logger.js';

/**
 * Follow status
 */
export type FollowStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Follow record from database
 */
export interface FollowRecord {
  id: string;
  follower_id: string;
  following_id: string;
  ap_follow_id: string | null;
  status: FollowStatus;
  created_at: Date;
}

/**
 * Create a new follow relationship
 */
export async function createFollow(data: {
  followerId: string;
  followingId: string;
  apFollowId?: string;
  status?: FollowStatus;
}): Promise<FollowRecord> {
  const logger = dbLogger();

  const result = await query<FollowRecord>(
    `INSERT INTO follows (follower_id, following_id, ap_follow_id, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (follower_id, following_id) DO UPDATE SET
       ap_follow_id = COALESCE(EXCLUDED.ap_follow_id, follows.ap_follow_id),
       status = COALESCE(EXCLUDED.status, follows.status)
     RETURNING *`,
    [data.followerId, data.followingId, data.apFollowId ?? null, data.status ?? 'pending']
  );

  const follow = result.rows[0];
  if (follow === undefined) {
    throw new Error('Failed to create follow record');
  }

  logger.debug('Created/updated follow relationship', {
    id: follow.id,
    followerId: data.followerId,
    followingId: data.followingId,
    status: follow.status,
  });

  return follow;
}

/**
 * Find a follow relationship by follower and following IDs
 */
export async function findByFollowerAndFollowing(
  followerId: string,
  followingId: string
): Promise<FollowRecord | null> {
  const result = await query<FollowRecord>(
    'SELECT * FROM follows WHERE follower_id = $1 AND following_id = $2',
    [followerId, followingId]
  );

  return result.rows[0] ?? null;
}

/**
 * Find a follow by AP follow ID
 */
export async function findByAPFollowId(apFollowId: string): Promise<FollowRecord | null> {
  const result = await query<FollowRecord>(
    'SELECT * FROM follows WHERE ap_follow_id = $1',
    [apFollowId]
  );

  return result.rows[0] ?? null;
}

/**
 * Find a follow by ID
 */
export async function findById(id: string): Promise<FollowRecord | null> {
  const result = await query<FollowRecord>(
    'SELECT * FROM follows WHERE id = $1',
    [id]
  );

  return result.rows[0] ?? null;
}

/**
 * Update follow status
 */
export async function updateStatus(
  followerId: string,
  followingId: string,
  status: FollowStatus
): Promise<FollowRecord | null> {
  const logger = dbLogger();

  const result = await query<FollowRecord>(
    `UPDATE follows
     SET status = $3
     WHERE follower_id = $1 AND following_id = $2
     RETURNING *`,
    [followerId, followingId, status]
  );

  const follow = result.rows[0];
  if (follow !== undefined) {
    logger.debug('Updated follow status', {
      id: follow.id,
      status,
    });
  }

  return follow ?? null;
}

/**
 * Update follow status by AP follow ID
 */
export async function updateStatusByAPFollowId(
  apFollowId: string,
  status: FollowStatus
): Promise<FollowRecord | null> {
  const logger = dbLogger();

  const result = await query<FollowRecord>(
    `UPDATE follows
     SET status = $2
     WHERE ap_follow_id = $1
     RETURNING *`,
    [apFollowId, status]
  );

  const follow = result.rows[0];
  if (follow !== undefined) {
    logger.debug('Updated follow status by AP follow ID', {
      apFollowId,
      status,
    });
  }

  return follow ?? null;
}

/**
 * Delete a follow relationship
 */
export async function deleteFollow(
  followerId: string,
  followingId: string
): Promise<boolean> {
  const result = await query(
    'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2',
    [followerId, followingId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete a follow by AP follow ID
 */
export async function deleteByAPFollowId(apFollowId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM follows WHERE ap_follow_id = $1',
    [apFollowId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Find all followers of a user
 */
export async function findFollowers(
  userId: string,
  status?: FollowStatus,
  limit = 100,
  offset = 0
): Promise<FollowRecord[]> {
  let sql = 'SELECT * FROM follows WHERE following_id = $1';
  const params: (string | number)[] = [userId];

  if (status !== undefined) {
    sql += ' AND status = $2';
    params.push(status);
    sql += ' ORDER BY created_at DESC LIMIT $3 OFFSET $4';
    params.push(limit, offset);
  } else {
    sql += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    params.push(limit, offset);
  }

  const result = await query<FollowRecord>(sql, params);
  return result.rows;
}

/**
 * Find all users that a user is following
 */
export async function findFollowing(
  userId: string,
  status?: FollowStatus,
  limit = 100,
  offset = 0
): Promise<FollowRecord[]> {
  let sql = 'SELECT * FROM follows WHERE follower_id = $1';
  const params: (string | number)[] = [userId];

  if (status !== undefined) {
    sql += ' AND status = $2';
    params.push(status);
    sql += ' ORDER BY created_at DESC LIMIT $3 OFFSET $4';
    params.push(limit, offset);
  } else {
    sql += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    params.push(limit, offset);
  }

  const result = await query<FollowRecord>(sql, params);
  return result.rows;
}

/**
 * Count followers of a user
 */
export async function countFollowers(
  userId: string,
  status?: FollowStatus
): Promise<number> {
  let sql = 'SELECT COUNT(*) as count FROM follows WHERE following_id = $1';
  const params: string[] = [userId];

  if (status !== undefined) {
    sql += ' AND status = $2';
    params.push(status);
  }

  const result = await query<{ count: string }>(sql, params);
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Count users that a user is following
 */
export async function countFollowing(
  userId: string,
  status?: FollowStatus
): Promise<number> {
  let sql = 'SELECT COUNT(*) as count FROM follows WHERE follower_id = $1';
  const params: string[] = [userId];

  if (status !== undefined) {
    sql += ' AND status = $2';
    params.push(status);
  }

  const result = await query<{ count: string }>(sql, params);
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Check if a user is following another user
 */
export async function isFollowing(
  followerId: string,
  followingId: string
): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM follows
     WHERE follower_id = $1 AND following_id = $2 AND status = 'accepted'`,
    [followerId, followingId]
  );
  return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
}

/**
 * Get follow IDs for all accepted followers (for fan-out delivery)
 */
export async function getAcceptedFollowerIds(userId: string): Promise<string[]> {
  const result = await query<{ follower_id: string }>(
    `SELECT follower_id FROM follows
     WHERE following_id = $1 AND status = 'accepted'`,
    [userId]
  );
  return result.rows.map((row) => row.follower_id);
}
