import { query } from '../index.js';
import { dbLogger } from '../../utils/logger.js';

/**
 * Block type
 */
export type BlockType = 'user' | 'instance';

/**
 * Block record from database
 */
export interface BlockRecord {
  id: string;
  blocker_id: string | null;
  blocked_user_id: string | null;
  blocked_instance: string | null;
  block_type: BlockType;
  reason: string | null;
  ap_block_id: string | null;
  created_at: Date;
}

/**
 * Create blocks table if it doesn't exist (migration helper)
 */
export async function ensureBlocksTable(): Promise<void> {
  await query(`
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
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_blocks_instance ON blocks(blocked_instance);
  `);
}

/**
 * Create a user block
 */
export async function createUserBlock(data: {
  blockerId: string;
  blockedUserId: string;
  reason?: string;
  apBlockId?: string;
}): Promise<BlockRecord> {
  const logger = dbLogger();

  const result = await query<BlockRecord>(
    `INSERT INTO blocks (blocker_id, blocked_user_id, block_type, reason, ap_block_id)
     VALUES ($1, $2, 'user', $3, $4)
     ON CONFLICT (blocker_id, blocked_user_id) DO UPDATE SET
       reason = COALESCE(EXCLUDED.reason, blocks.reason),
       ap_block_id = COALESCE(EXCLUDED.ap_block_id, blocks.ap_block_id)
     RETURNING *`,
    [data.blockerId, data.blockedUserId, data.reason ?? null, data.apBlockId ?? null]
  );

  const block = result.rows[0];
  if (block === undefined) {
    throw new Error('Failed to create user block');
  }

  logger.info('Created user block', {
    blockerId: data.blockerId,
    blockedUserId: data.blockedUserId,
  });

  return block;
}

/**
 * Create an instance block (admin only)
 */
export async function createInstanceBlock(data: {
  blockerId?: string;
  blockedInstance: string;
  reason?: string;
}): Promise<BlockRecord> {
  const logger = dbLogger();

  const result = await query<BlockRecord>(
    `INSERT INTO blocks (blocker_id, blocked_instance, block_type, reason)
     VALUES ($1, $2, 'instance', $3)
     ON CONFLICT (blocker_id, blocked_instance) DO UPDATE SET
       reason = COALESCE(EXCLUDED.reason, blocks.reason)
     RETURNING *`,
    [data.blockerId ?? null, data.blockedInstance.toLowerCase(), data.reason ?? null]
  );

  const block = result.rows[0];
  if (block === undefined) {
    throw new Error('Failed to create instance block');
  }

  logger.info('Created instance block', {
    blockedInstance: data.blockedInstance,
    reason: data.reason,
  });

  return block;
}

/**
 * Check if a user is blocked by another user
 */
export async function isUserBlocked(
  blockerId: string,
  blockedUserId: string
): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM blocks
     WHERE blocker_id = $1 AND blocked_user_id = $2 AND block_type = 'user'`,
    [blockerId, blockedUserId]
  );
  return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
}

/**
 * Check if an instance is blocked (global blocks have blocker_id = NULL)
 */
export async function isInstanceBlocked(instance: string): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM blocks
     WHERE blocked_instance = $1 AND block_type = 'instance'`,
    [instance.toLowerCase()]
  );
  return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
}

/**
 * Check if an actor URL is from a blocked instance
 */
export async function isActorFromBlockedInstance(actorUrl: string): Promise<boolean> {
  try {
    const url = new URL(actorUrl);
    return await isInstanceBlocked(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Find a user block
 */
export async function findUserBlock(
  blockerId: string,
  blockedUserId: string
): Promise<BlockRecord | null> {
  const result = await query<BlockRecord>(
    `SELECT * FROM blocks
     WHERE blocker_id = $1 AND blocked_user_id = $2 AND block_type = 'user'`,
    [blockerId, blockedUserId]
  );
  return result.rows[0] ?? null;
}

/**
 * Find an instance block
 */
export async function findInstanceBlock(instance: string): Promise<BlockRecord | null> {
  const result = await query<BlockRecord>(
    `SELECT * FROM blocks
     WHERE blocked_instance = $1 AND block_type = 'instance'`,
    [instance.toLowerCase()]
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a user block
 */
export async function deleteUserBlock(
  blockerId: string,
  blockedUserId: string
): Promise<boolean> {
  const result = await query(
    `DELETE FROM blocks
     WHERE blocker_id = $1 AND blocked_user_id = $2 AND block_type = 'user'`,
    [blockerId, blockedUserId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete an instance block
 */
export async function deleteInstanceBlock(instance: string): Promise<boolean> {
  const logger = dbLogger();

  const result = await query(
    `DELETE FROM blocks
     WHERE blocked_instance = $1 AND block_type = 'instance'`,
    [instance.toLowerCase()]
  );

  if ((result.rowCount ?? 0) > 0) {
    logger.info('Deleted instance block', { instance });
    return true;
  }
  return false;
}

/**
 * Get all user blocks for a user
 */
export async function getUserBlocks(
  blockerId: string,
  limit = 100,
  offset = 0
): Promise<BlockRecord[]> {
  const result = await query<BlockRecord>(
    `SELECT * FROM blocks
     WHERE blocker_id = $1 AND block_type = 'user'
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [blockerId, limit, offset]
  );
  return result.rows;
}

/**
 * Get all instance blocks
 */
export async function getInstanceBlocks(
  limit = 100,
  offset = 0
): Promise<BlockRecord[]> {
  const result = await query<BlockRecord>(
    `SELECT * FROM blocks
     WHERE block_type = 'instance'
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [limit, offset]
  );
  return result.rows;
}

/**
 * Count user blocks for a user
 */
export async function countUserBlocks(blockerId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM blocks
     WHERE blocker_id = $1 AND block_type = 'user'`,
    [blockerId]
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Count all instance blocks
 */
export async function countInstanceBlocks(): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM blocks WHERE block_type = 'instance'`
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Get all blocked instance domains
 */
export async function getBlockedInstanceDomains(): Promise<string[]> {
  const result = await query<{ blocked_instance: string }>(
    `SELECT blocked_instance FROM blocks WHERE block_type = 'instance' AND blocked_instance IS NOT NULL`
  );
  return result.rows.map((row) => row.blocked_instance);
}
