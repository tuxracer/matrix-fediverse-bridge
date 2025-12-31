import { query } from '../index.js';
import { dbLogger } from '../../utils/logger.js';

/**
 * Media record from database
 */
export interface MediaRecord {
  id: string;
  matrix_mxc_url: string | null;
  ap_media_url: string | null;
  mime_type: string | null;
  file_size: number | null;
  blurhash: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  alt_text: string | null;
  created_at: Date;
}

/**
 * Create a new media record
 */
export async function createMedia(data: {
  matrixMxcUrl?: string;
  apMediaUrl?: string;
  mimeType?: string;
  fileSize?: number;
  blurhash?: string;
  width?: number;
  height?: number;
  duration?: number;
  altText?: string;
}): Promise<MediaRecord> {
  const logger = dbLogger();

  const result = await query<MediaRecord>(
    `INSERT INTO media (
      matrix_mxc_url, ap_media_url, mime_type, file_size,
      blurhash, width, height, duration, alt_text
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      data.matrixMxcUrl ?? null,
      data.apMediaUrl ?? null,
      data.mimeType ?? null,
      data.fileSize ?? null,
      data.blurhash ?? null,
      data.width ?? null,
      data.height ?? null,
      data.duration ?? null,
      data.altText ?? null,
    ]
  );

  const media = result.rows[0];
  if (media === undefined) {
    throw new Error('Failed to create media record');
  }

  logger.debug('Created media record', {
    id: media.id,
    mxcUrl: data.matrixMxcUrl,
    apUrl: data.apMediaUrl,
  });

  return media;
}

/**
 * Find media by MXC URL
 */
export async function findByMxcUrl(mxcUrl: string): Promise<MediaRecord | null> {
  const result = await query<MediaRecord>(
    'SELECT * FROM media WHERE matrix_mxc_url = $1',
    [mxcUrl]
  );
  return result.rows[0] ?? null;
}

/**
 * Find media by ActivityPub URL
 */
export async function findByAPUrl(apUrl: string): Promise<MediaRecord | null> {
  const result = await query<MediaRecord>(
    'SELECT * FROM media WHERE ap_media_url = $1',
    [apUrl]
  );
  return result.rows[0] ?? null;
}

/**
 * Find media by ID
 */
export async function findById(id: string): Promise<MediaRecord | null> {
  const result = await query<MediaRecord>(
    'SELECT * FROM media WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Update media record with MXC URL
 */
export async function setMxcUrl(
  id: string,
  mxcUrl: string
): Promise<MediaRecord | null> {
  const result = await query<MediaRecord>(
    `UPDATE media SET matrix_mxc_url = $2 WHERE id = $1 RETURNING *`,
    [id, mxcUrl]
  );
  return result.rows[0] ?? null;
}

/**
 * Update media record with AP URL
 */
export async function setAPUrl(
  id: string,
  apUrl: string
): Promise<MediaRecord | null> {
  const result = await query<MediaRecord>(
    `UPDATE media SET ap_media_url = $2 WHERE id = $1 RETURNING *`,
    [id, apUrl]
  );
  return result.rows[0] ?? null;
}

/**
 * Update media metadata
 */
export async function updateMetadata(
  id: string,
  data: {
    mimeType?: string;
    fileSize?: number;
    blurhash?: string;
    width?: number;
    height?: number;
    duration?: number;
    altText?: string;
  }
): Promise<MediaRecord | null> {
  const result = await query<MediaRecord>(
    `UPDATE media SET
      mime_type = COALESCE($2, mime_type),
      file_size = COALESCE($3, file_size),
      blurhash = COALESCE($4, blurhash),
      width = COALESCE($5, width),
      height = COALESCE($6, height),
      duration = COALESCE($7, duration),
      alt_text = COALESCE($8, alt_text)
    WHERE id = $1
    RETURNING *`,
    [
      id,
      data.mimeType ?? null,
      data.fileSize ?? null,
      data.blurhash ?? null,
      data.width ?? null,
      data.height ?? null,
      data.duration ?? null,
      data.altText ?? null,
    ]
  );
  return result.rows[0] ?? null;
}

/**
 * Get or create media by MXC URL
 */
export async function getOrCreateByMxcUrl(
  mxcUrl: string,
  data?: {
    mimeType?: string;
    fileSize?: number;
    width?: number;
    height?: number;
    altText?: string;
  }
): Promise<MediaRecord> {
  const existing = await findByMxcUrl(mxcUrl);
  if (existing !== null) {
    return existing;
  }

  return createMedia({
    matrixMxcUrl: mxcUrl,
    ...data,
  });
}

/**
 * Get or create media by AP URL
 */
export async function getOrCreateByAPUrl(
  apUrl: string,
  data?: {
    mimeType?: string;
    fileSize?: number;
    width?: number;
    height?: number;
    blurhash?: string;
    altText?: string;
  }
): Promise<MediaRecord> {
  const existing = await findByAPUrl(apUrl);
  if (existing !== null) {
    return existing;
  }

  return createMedia({
    apMediaUrl: apUrl,
    ...data,
  });
}

/**
 * Delete media by ID
 */
export async function deleteMedia(id: string): Promise<boolean> {
  const result = await query('DELETE FROM media WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Get total media count
 */
export async function countAll(): Promise<number> {
  const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM media');
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Get total media size
 */
export async function getTotalSize(): Promise<number> {
  const result = await query<{ total: string }>(
    'SELECT COALESCE(SUM(file_size), 0) as total FROM media'
  );
  return parseInt(result.rows[0]?.total ?? '0', 10);
}

/**
 * Find media older than specified days
 */
export async function findOlderThan(days: number, limit = 100): Promise<MediaRecord[]> {
  const result = await query<MediaRecord>(
    `SELECT * FROM media
     WHERE created_at < NOW() - INTERVAL '${days} days'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/**
 * Delete media older than specified days
 */
export async function deleteOlderThan(days: number): Promise<number> {
  const result = await query(
    `DELETE FROM media WHERE created_at < NOW() - INTERVAL '${days} days'`
  );
  return result.rowCount ?? 0;
}
