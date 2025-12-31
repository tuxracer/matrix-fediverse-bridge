import { query } from '../index.js';
import { dbLogger } from '../../utils/logger.js';

/**
 * Room type
 */
export type RoomType = 'dm' | 'group' | 'public';

/**
 * Room record from database
 */
export interface RoomRecord {
  id: string;
  matrix_room_id: string;
  ap_context_id: string | null;
  room_type: RoomType | null;
  created_at: Date;
}

/**
 * Create a new room mapping
 */
export async function createRoom(data: {
  matrixRoomId: string;
  apContextId?: string;
  roomType?: RoomType;
}): Promise<RoomRecord> {
  const logger = dbLogger();

  const result = await query<RoomRecord>(
    `INSERT INTO rooms (matrix_room_id, ap_context_id, room_type)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.matrixRoomId, data.apContextId ?? null, data.roomType ?? null]
  );

  const room = result.rows[0];
  if (room === undefined) {
    throw new Error('Failed to create room record');
  }

  logger.debug('Created room mapping', {
    id: room.id,
    matrixRoomId: data.matrixRoomId,
    roomType: data.roomType,
  });

  return room;
}

/**
 * Find a room by Matrix room ID
 */
export async function findByMatrixRoomId(
  matrixRoomId: string
): Promise<RoomRecord | null> {
  const result = await query<RoomRecord>(
    'SELECT * FROM rooms WHERE matrix_room_id = $1',
    [matrixRoomId]
  );

  return result.rows[0] ?? null;
}

/**
 * Find a room by AP context ID
 */
export async function findByAPContextId(
  apContextId: string
): Promise<RoomRecord | null> {
  const result = await query<RoomRecord>(
    'SELECT * FROM rooms WHERE ap_context_id = $1',
    [apContextId]
  );

  return result.rows[0] ?? null;
}

/**
 * Find a room by ID
 */
export async function findById(id: string): Promise<RoomRecord | null> {
  const result = await query<RoomRecord>(
    'SELECT * FROM rooms WHERE id = $1',
    [id]
  );

  return result.rows[0] ?? null;
}

/**
 * Get or create a room mapping
 */
export async function getOrCreateRoom(data: {
  matrixRoomId: string;
  apContextId?: string;
  roomType?: RoomType;
}): Promise<RoomRecord> {
  // Try to find existing room
  const existing = await findByMatrixRoomId(data.matrixRoomId);
  if (existing !== null) {
    return existing;
  }

  // Create new room
  return createRoom(data);
}

/**
 * Update room type
 */
export async function updateRoomType(
  matrixRoomId: string,
  roomType: RoomType
): Promise<RoomRecord | null> {
  const result = await query<RoomRecord>(
    `UPDATE rooms
     SET room_type = $2
     WHERE matrix_room_id = $1
     RETURNING *`,
    [matrixRoomId, roomType]
  );

  return result.rows[0] ?? null;
}

/**
 * Update AP context ID
 */
export async function updateAPContextId(
  matrixRoomId: string,
  apContextId: string
): Promise<RoomRecord | null> {
  const result = await query<RoomRecord>(
    `UPDATE rooms
     SET ap_context_id = $2
     WHERE matrix_room_id = $1
     RETURNING *`,
    [matrixRoomId, apContextId]
  );

  return result.rows[0] ?? null;
}

/**
 * Delete a room by ID
 */
export async function deleteRoom(id: string): Promise<boolean> {
  const result = await query('DELETE FROM rooms WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete a room by Matrix room ID
 */
export async function deleteByMatrixRoomId(matrixRoomId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM rooms WHERE matrix_room_id = $1',
    [matrixRoomId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Find rooms by type
 */
export async function findByType(
  roomType: RoomType,
  limit = 100,
  offset = 0
): Promise<RoomRecord[]> {
  const result = await query<RoomRecord>(
    `SELECT * FROM rooms
     WHERE room_type = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [roomType, limit, offset]
  );

  return result.rows;
}

/**
 * Count rooms by type
 */
export async function countByType(roomType: RoomType): Promise<number> {
  const result = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM rooms WHERE room_type = $1',
    [roomType]
  );

  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Get total room count
 */
export async function countAll(): Promise<number> {
  const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM rooms');
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Detect room type from Matrix room state
 * This is a helper that would be called with room state information
 */
export function detectRoomType(memberCount: number, isEncrypted: boolean): RoomType {
  if (memberCount === 2 && isEncrypted) {
    return 'dm';
  } else if (memberCount <= 10) {
    return 'group';
  } else {
    return 'public';
  }
}

/**
 * Generate an AP context ID for a room
 */
export function generateAPContextId(baseUrl: string, matrixRoomId: string): string {
  const encoded = Buffer.from(matrixRoomId).toString('base64url');
  return `${baseUrl}/contexts/${encoded}`;
}
