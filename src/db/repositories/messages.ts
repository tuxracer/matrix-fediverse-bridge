import { query, withTransaction } from '../index.js';
import { dbLogger } from '../../utils/logger.js';

/**
 * Message record from database
 */
export interface MessageRecord {
  id: string;
  matrix_event_id: string | null;
  ap_object_id: string | null;
  room_id: string | null;
  sender_id: string | null;
  created_at: Date;
}

/**
 * Create a new message mapping
 */
export async function createMessage(data: {
  matrixEventId?: string;
  apObjectId?: string;
  roomId?: string;
  senderId?: string;
}): Promise<MessageRecord> {
  const logger = dbLogger();

  const result = await query<MessageRecord>(
    `INSERT INTO messages (matrix_event_id, ap_object_id, room_id, sender_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.matrixEventId ?? null, data.apObjectId ?? null, data.roomId ?? null, data.senderId ?? null]
  );

  const message = result.rows[0];
  if (message === undefined) {
    throw new Error('Failed to create message record');
  }

  logger.debug('Created message mapping', {
    id: message.id,
    matrixEventId: data.matrixEventId,
    apObjectId: data.apObjectId,
  });

  return message;
}

/**
 * Find a message by Matrix event ID
 */
export async function findByMatrixEventId(
  matrixEventId: string
): Promise<MessageRecord | null> {
  const result = await query<MessageRecord>(
    'SELECT * FROM messages WHERE matrix_event_id = $1',
    [matrixEventId]
  );

  return result.rows[0] ?? null;
}

/**
 * Find a message by ActivityPub object ID
 */
export async function findByAPObjectId(
  apObjectId: string
): Promise<MessageRecord | null> {
  const result = await query<MessageRecord>(
    'SELECT * FROM messages WHERE ap_object_id = $1',
    [apObjectId]
  );

  return result.rows[0] ?? null;
}

/**
 * Find a message by ID
 */
export async function findById(id: string): Promise<MessageRecord | null> {
  const result = await query<MessageRecord>(
    'SELECT * FROM messages WHERE id = $1',
    [id]
  );

  return result.rows[0] ?? null;
}

/**
 * Update a message's AP object ID
 */
export async function setAPObjectId(
  matrixEventId: string,
  apObjectId: string
): Promise<MessageRecord | null> {
  const result = await query<MessageRecord>(
    `UPDATE messages
     SET ap_object_id = $2
     WHERE matrix_event_id = $1
     RETURNING *`,
    [matrixEventId, apObjectId]
  );

  return result.rows[0] ?? null;
}

/**
 * Update a message's Matrix event ID
 */
export async function setMatrixEventId(
  apObjectId: string,
  matrixEventId: string
): Promise<MessageRecord | null> {
  const result = await query<MessageRecord>(
    `UPDATE messages
     SET matrix_event_id = $2
     WHERE ap_object_id = $1
     RETURNING *`,
    [apObjectId, matrixEventId]
  );

  return result.rows[0] ?? null;
}

/**
 * Create or update a message mapping
 */
export async function upsertMessage(data: {
  matrixEventId?: string;
  apObjectId?: string;
  roomId?: string;
  senderId?: string;
}): Promise<MessageRecord> {
  const logger = dbLogger();

  // Try to find existing by either ID
  let existing: MessageRecord | null = null;

  if (data.matrixEventId !== undefined) {
    existing = await findByMatrixEventId(data.matrixEventId);
  }

  if (existing === null && data.apObjectId !== undefined) {
    existing = await findByAPObjectId(data.apObjectId);
  }

  if (existing !== null) {
    // Update existing record
    const result = await query<MessageRecord>(
      `UPDATE messages
       SET matrix_event_id = COALESCE($2, matrix_event_id),
           ap_object_id = COALESCE($3, ap_object_id),
           room_id = COALESCE($4, room_id),
           sender_id = COALESCE($5, sender_id)
       WHERE id = $1
       RETURNING *`,
      [existing.id, data.matrixEventId ?? null, data.apObjectId ?? null, data.roomId ?? null, data.senderId ?? null]
    );

    const updated = result.rows[0];
    if (updated === undefined) {
      throw new Error('Failed to update message record');
    }

    logger.debug('Updated message mapping', {
      id: updated.id,
      matrixEventId: data.matrixEventId,
      apObjectId: data.apObjectId,
    });

    return updated;
  }

  // Create new record
  return createMessage(data);
}

/**
 * Delete a message by ID
 */
export async function deleteMessage(id: string): Promise<boolean> {
  const result = await query('DELETE FROM messages WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete a message by Matrix event ID
 */
export async function deleteByMatrixEventId(matrixEventId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM messages WHERE matrix_event_id = $1',
    [matrixEventId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete a message by AP object ID
 */
export async function deleteByAPObjectId(apObjectId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM messages WHERE ap_object_id = $1',
    [apObjectId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Find messages by room ID
 */
export async function findByRoomId(
  roomId: string,
  limit = 100,
  offset = 0
): Promise<MessageRecord[]> {
  const result = await query<MessageRecord>(
    `SELECT * FROM messages
     WHERE room_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [roomId, limit, offset]
  );

  return result.rows;
}

/**
 * Count messages in a room
 */
export async function countByRoomId(roomId: string): Promise<number> {
  const result = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM messages WHERE room_id = $1',
    [roomId]
  );

  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Get total message count
 */
export async function countAll(): Promise<number> {
  const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM messages');
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Clean up old messages (for maintenance)
 */
export async function deleteOlderThan(days: number): Promise<number> {
  const result = await query(
    `DELETE FROM messages
     WHERE created_at < NOW() - INTERVAL '${days} days'`
  );
  return result.rowCount ?? 0;
}
