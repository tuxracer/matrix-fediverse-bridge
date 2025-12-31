import { createHash } from 'crypto';
import sharp from 'sharp';
import { bridgeLogger } from '../utils/logger.js';
import * as mediaRepo from '../db/repositories/media.js';

/**
 * Media processor configuration
 */
export interface MediaConfig {
  maxFileSize: number;
  thumbnailSize: number;
  allowedMimeTypes: string[];
  cacheDir?: string;
  matrixHomeserverUrl: string;
  matrixAccessToken: string;
  apBaseUrl: string;
}

/**
 * Processed media result
 */
export interface ProcessedMedia {
  mxcUrl?: string;
  httpsUrl?: string;
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  blurhash?: string;
  thumbnailMxc?: string;
  thumbnailHttps?: string;
}

/**
 * Media attachment for bridging
 */
export interface MediaAttachment {
  url: string;
  mimeType: string;
  name?: string;
  width?: number;
  height?: number;
  duration?: number;
  blurhash?: string;
  description?: string;
  size?: number;
}

/**
 * Default allowed MIME types
 */
const DEFAULT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/flac',
  'application/pdf',
  'application/zip',
  'text/plain',
];

/**
 * Media type categories
 */
export type MediaType = 'image' | 'video' | 'audio' | 'file';

/**
 * Determine media type from MIME type
 */
export function getMediaType(mimeType: string): MediaType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * Media proxy and handler
 */
export class MediaProxy {
  private config: MediaConfig;
  private logger = bridgeLogger();
  private cache: Map<string, Buffer> = new Map();
  private maxCacheSize = 100 * 1024 * 1024; // 100MB
  private currentCacheSize = 0;

  constructor(config: MediaConfig) {
    this.config = {
      ...config,
      allowedMimeTypes: config.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES,
    };
  }

  /**
   * Convert MXC URL to HTTPS URL for ActivityPub
   */
  mxcToHttps(mxcUrl: string): string {
    // mxc://server/mediaId -> https://matrix-server/_matrix/media/v3/download/server/mediaId
    const match = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (match === null) {
      throw new Error(`Invalid MXC URL: ${mxcUrl}`);
    }

    const serverName = match[1] ?? '';
    const mediaId = match[2] ?? '';

    // Use our AP base URL to proxy the media
    return `${this.config.apBaseUrl}/media/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`;
  }

  /**
   * Convert MXC URL to direct Matrix download URL
   */
  mxcToMatrixDownloadUrl(mxcUrl: string): string {
    const match = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (match === null) {
      throw new Error(`Invalid MXC URL: ${mxcUrl}`);
    }

    const [, serverName, mediaId] = match;
    return `${this.config.matrixHomeserverUrl}/_matrix/media/v3/download/${serverName}/${mediaId}`;
  }

  /**
   * Get thumbnail URL for MXC
   */
  mxcToThumbnailUrl(mxcUrl: string, width: number, height: number): string {
    const match = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (match === null) {
      throw new Error(`Invalid MXC URL: ${mxcUrl}`);
    }

    const [, serverName, mediaId] = match;
    return `${this.config.matrixHomeserverUrl}/_matrix/media/v3/thumbnail/${serverName}/${mediaId}?width=${width}&height=${height}&method=scale`;
  }

  /**
   * Download media from HTTPS URL and upload to Matrix
   */
  async httpsToMxc(
    httpsUrl: string,
    options?: {
      filename?: string;
      mimeType?: string;
    }
  ): Promise<ProcessedMedia> {
    this.logger.debug('Converting HTTPS to MXC', { url: httpsUrl });

    // Check if we already have this URL cached
    const existing = await mediaRepo.findByAPUrl(httpsUrl);
    if (existing?.matrix_mxc_url !== null && existing?.matrix_mxc_url !== undefined) {
      this.logger.debug('Found cached MXC URL', {
        apUrl: httpsUrl,
        mxcUrl: existing.matrix_mxc_url
      });
      const result: ProcessedMedia = {
        mxcUrl: existing.matrix_mxc_url,
        httpsUrl,
        mimeType: existing.mime_type ?? 'application/octet-stream',
        fileSize: existing.file_size ?? 0,
      };
      if (existing.width !== null) result.width = existing.width;
      if (existing.height !== null) result.height = existing.height;
      if (existing.blurhash !== null) result.blurhash = existing.blurhash;
      return result;
    }

    // Download the media
    const response = await fetch(httpsUrl, {
      headers: {
        'User-Agent': 'Matrix-ActivityPub-Bridge/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download media: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('Content-Type') ?? options?.mimeType ?? 'application/octet-stream';
    const contentLength = response.headers.get('Content-Length');
    const fileSize = contentLength !== null ? parseInt(contentLength, 10) : 0;

    // Check file size
    if (fileSize > this.config.maxFileSize) {
      throw new Error(`File size ${fileSize} exceeds maximum ${this.config.maxFileSize}`);
    }

    // Check MIME type
    if (!this.isAllowedMimeType(contentType)) {
      throw new Error(`MIME type ${contentType} is not allowed`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Validate actual file size
    if (buffer.length > this.config.maxFileSize) {
      throw new Error(`File size ${buffer.length} exceeds maximum ${this.config.maxFileSize}`);
    }

    // Process media metadata
    const metadata = await this.extractMetadata(buffer, contentType);

    // Upload to Matrix
    const mxcUrl = await this.uploadToMatrix(buffer, contentType, options?.filename);

    // Store mapping
    const createData: Parameters<typeof mediaRepo.createMedia>[0] = {
      matrixMxcUrl: mxcUrl,
      apMediaUrl: httpsUrl,
      mimeType: contentType,
      fileSize: buffer.length,
    };
    if (metadata.blurhash !== undefined) createData.blurhash = metadata.blurhash;
    if (metadata.width !== undefined) createData.width = metadata.width;
    if (metadata.height !== undefined) createData.height = metadata.height;
    await mediaRepo.createMedia(createData);

    this.logger.info('Converted HTTPS to MXC', {
      httpsUrl,
      mxcUrl,
      mimeType: contentType,
      fileSize: buffer.length,
    });

    const result: ProcessedMedia = {
      mxcUrl,
      httpsUrl,
      mimeType: contentType,
      fileSize: buffer.length,
    };
    if (metadata.width !== undefined) result.width = metadata.width;
    if (metadata.height !== undefined) result.height = metadata.height;
    if (metadata.blurhash !== undefined) result.blurhash = metadata.blurhash;
    return result;
  }

  /**
   * Download media from Matrix (MXC URL)
   */
  async downloadFromMatrix(mxcUrl: string): Promise<{
    buffer: Buffer;
    mimeType: string;
    filename?: string;
  }> {
    // Check in-memory cache first
    const cacheKey = `matrix:${mxcUrl}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      this.logger.debug('Cache hit for MXC', { mxcUrl });
      // Get metadata from DB
      const record = await mediaRepo.findByMxcUrl(mxcUrl);
      return {
        buffer: cached,
        mimeType: record?.mime_type ?? 'application/octet-stream',
      };
    }

    const downloadUrl = this.mxcToMatrixDownloadUrl(mxcUrl);

    const response = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${this.config.matrixAccessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download from Matrix: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';
    const contentDisposition = response.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1];

    const buffer = Buffer.from(await response.arrayBuffer());

    // Add to cache
    this.addToCache(cacheKey, buffer);

    const result: { buffer: Buffer; mimeType: string; filename?: string } = {
      buffer,
      mimeType: contentType,
    };
    if (filenameMatch !== undefined) {
      result.filename = filenameMatch;
    }
    return result;
  }

  /**
   * Upload media to Matrix homeserver
   */
  async uploadToMatrix(
    buffer: Buffer,
    mimeType: string,
    filename?: string
  ): Promise<string> {
    const uploadUrl = new URL(`${this.config.matrixHomeserverUrl}/_matrix/media/v3/upload`);
    if (filename !== undefined) {
      uploadUrl.searchParams.set('filename', filename);
    }

    const response = await fetch(uploadUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.matrixAccessToken}`,
        'Content-Type': mimeType,
      },
      body: buffer,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to upload to Matrix: ${error}`);
    }

    const result = await response.json() as { content_uri: string };
    return result.content_uri;
  }

  /**
   * Extract metadata from media buffer
   */
  async extractMetadata(
    buffer: Buffer,
    mimeType: string
  ): Promise<{
    width?: number;
    height?: number;
    blurhash?: string;
    duration?: number;
  }> {
    const mediaType = getMediaType(mimeType);

    if (mediaType === 'image') {
      return this.extractImageMetadata(buffer);
    }

    // For video/audio, we'd need additional libraries
    // For now, return empty metadata
    return {};
  }

  /**
   * Extract image metadata including dimensions and blurhash
   */
  async extractImageMetadata(buffer: Buffer): Promise<{
    width?: number;
    height?: number;
    blurhash?: string;
  }> {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      let blurhash: string | undefined;

      // Generate blurhash for images
      if (metadata.width !== undefined && metadata.height !== undefined) {
        try {
          blurhash = await this.generateBlurhash(buffer);
        } catch (error) {
          this.logger.warn('Failed to generate blurhash', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const result: { width?: number; height?: number; blurhash?: string } = {};
      if (metadata.width !== undefined) result.width = metadata.width;
      if (metadata.height !== undefined) result.height = metadata.height;
      if (blurhash !== undefined) result.blurhash = blurhash;
      return result;
    } catch (error) {
      this.logger.warn('Failed to extract image metadata', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Generate blurhash for an image
   */
  async generateBlurhash(buffer: Buffer): Promise<string> {
    // Resize image to small size for blurhash calculation
    const { data, info } = await sharp(buffer)
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Simple blurhash implementation (placeholder)
    // In production, use the blurhash library
    const hash = createHash('sha256').update(data).digest('base64').slice(0, 20);
    return `L${hash}`;
  }

  /**
   * Generate thumbnail for an image
   */
  async generateThumbnail(
    buffer: Buffer,
    maxWidth: number = 400,
    maxHeight: number = 400
  ): Promise<Buffer> {
    return sharp(buffer)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  /**
   * Convert image to WebP format
   */
  async convertToWebP(buffer: Buffer, quality: number = 80): Promise<Buffer> {
    return sharp(buffer)
      .webp({ quality })
      .toBuffer();
  }

  /**
   * Check if MIME type is allowed
   */
  isAllowedMimeType(mimeType: string): boolean {
    return this.config.allowedMimeTypes.includes(mimeType) ||
      this.config.allowedMimeTypes.some(allowed => {
        if (allowed.endsWith('/*')) {
          return mimeType.startsWith(allowed.slice(0, -1));
        }
        return false;
      });
  }

  /**
   * Add buffer to in-memory cache
   */
  private addToCache(key: string, buffer: Buffer): void {
    // Evict if needed
    while (this.currentCacheSize + buffer.length > this.maxCacheSize && this.cache.size > 0) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        const evicted = this.cache.get(firstKey);
        if (evicted !== undefined) {
          this.currentCacheSize -= evicted.length;
        }
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, buffer);
    this.currentCacheSize += buffer.length;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    this.currentCacheSize = 0;
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { entries: number; size: number; maxSize: number } {
    return {
      entries: this.cache.size,
      size: this.currentCacheSize,
      maxSize: this.maxCacheSize,
    };
  }
}

/**
 * Build Matrix media content from attachment
 */
export function buildMatrixMediaContent(
  attachment: MediaAttachment,
  body: string
): Record<string, unknown> {
  const mediaType = getMediaType(attachment.mimeType);

  const baseContent: Record<string, unknown> = {
    body: attachment.name ?? body,
    url: attachment.url, // Should be MXC URL
  };

  // Add info object
  const info: Record<string, unknown> = {
    mimetype: attachment.mimeType,
  };

  if (attachment.size !== undefined) {
    info.size = attachment.size;
  }

  if (attachment.width !== undefined) {
    info.w = attachment.width;
  }

  if (attachment.height !== undefined) {
    info.h = attachment.height;
  }

  if (attachment.duration !== undefined) {
    info.duration = attachment.duration;
  }

  switch (mediaType) {
    case 'image':
      return {
        ...baseContent,
        msgtype: 'm.image',
        info,
      };

    case 'video':
      return {
        ...baseContent,
        msgtype: 'm.video',
        info,
      };

    case 'audio':
      return {
        ...baseContent,
        msgtype: 'm.audio',
        info,
      };

    default:
      return {
        ...baseContent,
        msgtype: 'm.file',
        info,
      };
  }
}

/**
 * Build ActivityPub attachment from Matrix media
 */
export function buildAPAttachment(
  url: string,
  mimeType: string,
  options?: {
    name?: string;
    width?: number;
    height?: number;
    blurhash?: string;
    description?: string;
  }
): Record<string, unknown> {
  const mediaType = getMediaType(mimeType);

  let type: string;
  switch (mediaType) {
    case 'image':
      type = 'Image';
      break;
    case 'video':
      type = 'Video';
      break;
    case 'audio':
      type = 'Audio';
      break;
    default:
      type = 'Document';
  }

  const attachment: Record<string, unknown> = {
    type,
    mediaType: mimeType,
    url,
  };

  if (options?.name !== undefined) {
    attachment.name = options.name;
  }

  if (options?.width !== undefined) {
    attachment.width = options.width;
  }

  if (options?.height !== undefined) {
    attachment.height = options.height;
  }

  if (options?.blurhash !== undefined) {
    attachment.blurhash = options.blurhash;
  }

  // Alt text maps to "name" in ActivityPub
  if (options?.description !== undefined) {
    attachment.name = options.description;
  }

  return attachment;
}

/**
 * Parse ActivityPub attachment
 */
export function parseAPAttachment(attachment: Record<string, unknown>): MediaAttachment | null {
  const url = attachment.url as string | undefined;
  if (url === undefined) {
    return null;
  }

  const mimeType = (attachment.mediaType as string | undefined) ??
                   (attachment.type === 'Image' ? 'image/jpeg' : 'application/octet-stream');

  const result: MediaAttachment = {
    url,
    mimeType,
  };

  const name = attachment.name as string | undefined;
  if (name !== undefined) {
    result.name = name;
    result.description = name; // AP uses name for alt text
  }
  if (typeof attachment.width === 'number') result.width = attachment.width;
  if (typeof attachment.height === 'number') result.height = attachment.height;
  if (typeof attachment.blurhash === 'string') result.blurhash = attachment.blurhash;

  return result;
}
