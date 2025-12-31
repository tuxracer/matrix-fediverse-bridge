import { query } from '../index.js';
import { dbLogger } from '../../utils/logger.js';

/**
 * User record from database
 */
export interface UserRecord {
  id: string;
  matrix_user_id: string | null;
  ap_actor_id: string | null;
  ap_inbox_url: string | null;
  ap_shared_inbox_url: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_puppet: boolean;
  is_double_puppet: boolean;
  access_token_encrypted: Buffer | null;
  private_key_pem: string | null;
  public_key_pem: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Create a new user
 */
export async function createUser(data: {
  matrixUserId?: string;
  apActorId?: string;
  apInboxUrl?: string;
  apSharedInboxUrl?: string;
  displayName?: string;
  avatarUrl?: string;
  isPuppet?: boolean;
  isDoublePuppet?: boolean;
  privateKeyPem?: string;
  publicKeyPem?: string;
}): Promise<UserRecord> {
  const logger = dbLogger();

  const result = await query<UserRecord>(
    `INSERT INTO users (
      matrix_user_id, ap_actor_id, ap_inbox_url, ap_shared_inbox_url,
      display_name, avatar_url, is_puppet, is_double_puppet,
      private_key_pem, public_key_pem
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      data.matrixUserId ?? null,
      data.apActorId ?? null,
      data.apInboxUrl ?? null,
      data.apSharedInboxUrl ?? null,
      data.displayName ?? null,
      data.avatarUrl ?? null,
      data.isPuppet ?? false,
      data.isDoublePuppet ?? false,
      data.privateKeyPem ?? null,
      data.publicKeyPem ?? null,
    ]
  );

  const user = result.rows[0];
  if (user === undefined) {
    throw new Error('Failed to create user record');
  }

  logger.debug('Created user', {
    id: user.id,
    matrixUserId: data.matrixUserId,
    apActorId: data.apActorId,
  });

  return user;
}

/**
 * Find a user by ID
 */
export async function findById(id: string): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Find a user by Matrix user ID
 */
export async function findByMatrixId(matrixUserId: string): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    'SELECT * FROM users WHERE matrix_user_id = $1',
    [matrixUserId]
  );
  return result.rows[0] ?? null;
}

/**
 * Find a user by AP actor ID
 */
export async function findByAPActorId(apActorId: string): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    'SELECT * FROM users WHERE ap_actor_id = $1',
    [apActorId]
  );
  return result.rows[0] ?? null;
}

/**
 * Get or create a user by Matrix ID
 */
export async function getOrCreateByMatrixId(
  matrixUserId: string,
  data?: {
    displayName?: string;
    avatarUrl?: string;
  }
): Promise<UserRecord> {
  const existing = await findByMatrixId(matrixUserId);
  if (existing !== null) {
    return existing;
  }

  return createUser({
    matrixUserId,
    displayName: data?.displayName,
    avatarUrl: data?.avatarUrl,
    isPuppet: false,
  });
}

/**
 * Get or create a user by AP actor ID
 */
export async function getOrCreateByAPActorId(
  apActorId: string,
  data?: {
    apInboxUrl?: string;
    apSharedInboxUrl?: string;
    displayName?: string;
    avatarUrl?: string;
  }
): Promise<UserRecord> {
  const existing = await findByAPActorId(apActorId);
  if (existing !== null) {
    // Update inbox URLs if provided
    if (data?.apInboxUrl !== undefined || data?.apSharedInboxUrl !== undefined) {
      await updateInboxUrls(apActorId, {
        inboxUrl: data.apInboxUrl,
        sharedInboxUrl: data.apSharedInboxUrl,
      });
    }
    return (await findByAPActorId(apActorId)) ?? existing;
  }

  return createUser({
    apActorId,
    apInboxUrl: data?.apInboxUrl,
    apSharedInboxUrl: data?.apSharedInboxUrl,
    displayName: data?.displayName,
    avatarUrl: data?.avatarUrl,
    isPuppet: true,
  });
}

/**
 * Update user profile
 */
export async function updateProfile(
  id: string,
  data: {
    displayName?: string;
    avatarUrl?: string;
  }
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
     SET display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url)
     WHERE id = $1
     RETURNING *`,
    [id, data.displayName ?? null, data.avatarUrl ?? null]
  );
  return result.rows[0] ?? null;
}

/**
 * Update inbox URLs
 */
export async function updateInboxUrls(
  apActorId: string,
  data: {
    inboxUrl?: string;
    sharedInboxUrl?: string;
  }
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
     SET ap_inbox_url = COALESCE($2, ap_inbox_url),
         ap_shared_inbox_url = COALESCE($3, ap_shared_inbox_url)
     WHERE ap_actor_id = $1
     RETURNING *`,
    [apActorId, data.inboxUrl ?? null, data.sharedInboxUrl ?? null]
  );
  return result.rows[0] ?? null;
}

/**
 * Store key pair for a user
 */
export async function setKeyPair(
  id: string,
  privateKeyPem: string,
  publicKeyPem: string
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
     SET private_key_pem = $2, public_key_pem = $3
     WHERE id = $1
     RETURNING *`,
    [id, privateKeyPem, publicKeyPem]
  );
  return result.rows[0] ?? null;
}

/**
 * Get key pair for a user
 */
export async function getKeyPair(id: string): Promise<{ privateKeyPem: string; publicKeyPem: string } | null> {
  const result = await query<UserRecord>(
    'SELECT private_key_pem, public_key_pem FROM users WHERE id = $1',
    [id]
  );
  const row = result.rows[0];
  if (row === undefined || row.private_key_pem === null || row.public_key_pem === null) {
    return null;
  }
  return {
    privateKeyPem: row.private_key_pem,
    publicKeyPem: row.public_key_pem,
  };
}

/**
 * Store encrypted access token for double-puppeting
 */
export async function setAccessToken(
  matrixUserId: string,
  encryptedToken: Buffer
): Promise<UserRecord | null> {
  const logger = dbLogger();

  const result = await query<UserRecord>(
    `UPDATE users
     SET access_token_encrypted = $2, is_double_puppet = TRUE
     WHERE matrix_user_id = $1
     RETURNING *`,
    [matrixUserId, encryptedToken]
  );

  if (result.rows[0] !== undefined) {
    logger.info('Stored access token for double-puppeting', { matrixUserId });
  }

  return result.rows[0] ?? null;
}

/**
 * Get encrypted access token
 */
export async function getAccessToken(matrixUserId: string): Promise<Buffer | null> {
  const result = await query<UserRecord>(
    'SELECT access_token_encrypted FROM users WHERE matrix_user_id = $1',
    [matrixUserId]
  );
  return result.rows[0]?.access_token_encrypted ?? null;
}

/**
 * Remove access token (logout)
 */
export async function removeAccessToken(matrixUserId: string): Promise<boolean> {
  const result = await query(
    `UPDATE users
     SET access_token_encrypted = NULL, is_double_puppet = FALSE
     WHERE matrix_user_id = $1`,
    [matrixUserId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete a user by ID
 */
export async function deleteUser(id: string): Promise<boolean> {
  const result = await query('DELETE FROM users WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Count all users
 */
export async function countAll(): Promise<number> {
  const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM users');
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Count puppet users (AP users bridged to Matrix)
 */
export async function countPuppets(): Promise<number> {
  const result = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM users WHERE is_puppet = TRUE'
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Count double-puppet users (Matrix users with AP representation)
 */
export async function countDoublePuppets(): Promise<number> {
  const result = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM users WHERE is_double_puppet = TRUE'
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Find users with AP followers (for determining if we need to fan out)
 */
export async function hasAPFollowers(userId: string): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM follows
     WHERE following_id = $1 AND status = 'accepted'`,
    [userId]
  );
  return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
}

/**
 * Get all users with their inbox URLs (for delivery)
 */
export async function getUsersWithInboxes(
  userIds: string[]
): Promise<Array<{ id: string; ap_inbox_url: string | null; ap_shared_inbox_url: string | null }>> {
  if (userIds.length === 0) {
    return [];
  }

  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = await query<{ id: string; ap_inbox_url: string | null; ap_shared_inbox_url: string | null }>(
    `SELECT id, ap_inbox_url, ap_shared_inbox_url FROM users WHERE id IN (${placeholders})`,
    userIds
  );
  return result.rows;
}

/**
 * Delete a user by ID
 */
export async function deleteById(userId: string): Promise<boolean> {
  const result = await query('DELETE FROM users WHERE id = $1', [userId]);
  return (result.rowCount ?? 0) > 0;
}
