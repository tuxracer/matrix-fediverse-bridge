import { bridgeLogger } from '../utils/logger.js';
import { getImageProcessor } from './imageProcessing.js';
import { MediaProxy, type MediaAttachment, getMediaType, type MediaType } from './media.js';
import * as mediaRepo from '../db/repositories/media.js';

/**
 * Matrix media message types
 */
export type MatrixMediaMsgtype = 'm.image' | 'm.video' | 'm.audio' | 'm.file';

/**
 * Matrix media content
 */
export interface MatrixMediaContent {
  msgtype: MatrixMediaMsgtype;
  body: string;
  url: string; // MXC URL
  info?: {
    mimetype?: string;
    size?: number;
    w?: number;
    h?: number;
    duration?: number;
    thumbnail_url?: string;
    thumbnail_info?: {
      mimetype?: string;
      size?: number;
      w?: number;
      h?: number;
    };
  };
  file?: {
    url: string;
    key: Record<string, unknown>;
    iv: string;
    hashes: Record<string, string>;
  };
}

/**
 * ActivityPub attachment types
 */
export type APAttachmentType = 'Image' | 'Video' | 'Audio' | 'Document';

/**
 * ActivityPub attachment
 */
export interface APAttachment {
  type: APAttachmentType;
  mediaType: string;
  url: string;
  name?: string;
  width?: number;
  height?: number;
  blurhash?: string;
  duration?: number;
  focalPoint?: [number, number];
}

/**
 * Media handler context
 */
export interface MediaHandlerContext {
  mediaProxy: MediaProxy;
  generateThumbnails: boolean;
  generateBlurhash: boolean;
  maxImageSize: number;
  thumbnailSize: number;
}

/**
 * Base media handler interface
 */
export interface MediaHandler {
  /**
   * Convert Matrix media to ActivityPub attachment
   */
  matrixToAP(content: MatrixMediaContent, context: MediaHandlerContext): Promise<APAttachment>;

  /**
   * Convert ActivityPub attachment to Matrix media content
   */
  apToMatrix(attachment: APAttachment, context: MediaHandlerContext): Promise<MatrixMediaContent>;
}

/**
 * Image media handler
 */
export class ImageHandler implements MediaHandler {
  private logger = bridgeLogger();

  async matrixToAP(
    content: MatrixMediaContent,
    context: MediaHandlerContext
  ): Promise<APAttachment> {
    const { mediaProxy, generateBlurhash } = context;

    // Convert MXC to HTTPS URL
    const httpsUrl = mediaProxy.mxcToHttps(content.url);

    // Build attachment
    const attachment: APAttachment = {
      type: 'Image',
      mediaType: content.info?.mimetype ?? 'image/jpeg',
      url: httpsUrl,
      name: content.body,
    };

    // Add dimensions if available
    if (content.info?.w !== undefined) {
      attachment.width = content.info.w;
    }
    if (content.info?.h !== undefined) {
      attachment.height = content.info.h;
    }

    // Generate blurhash if requested and we have the image
    if (generateBlurhash && content.info?.w !== undefined) {
      try {
        // Try to get from database first
        const existing = await mediaRepo.findByMxcUrl(content.url);
        if (existing?.blurhash !== null && existing?.blurhash !== undefined) {
          attachment.blurhash = existing.blurhash;
        } else {
          // Generate new blurhash
          const { buffer } = await mediaProxy.downloadFromMatrix(content.url);
          const processor = getImageProcessor();
          attachment.blurhash = await processor.generateBlurhash(buffer);

          // Store for future use
          if (existing !== null) {
            await mediaRepo.updateMetadata(existing.id, { blurhash: attachment.blurhash });
          }
        }
      } catch (error) {
        this.logger.warn('Failed to generate blurhash', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return attachment;
  }

  async apToMatrix(
    attachment: APAttachment,
    context: MediaHandlerContext
  ): Promise<MatrixMediaContent> {
    const { mediaProxy, generateThumbnails, thumbnailSize } = context;

    // Download and upload to Matrix
    const processed = await mediaProxy.httpsToMxc(attachment.url, {
      mimeType: attachment.mediaType,
      filename: attachment.name,
    });

    const content: MatrixMediaContent = {
      msgtype: 'm.image',
      body: attachment.name ?? 'image',
      url: processed.mxcUrl ?? '',
      info: {
        mimetype: attachment.mediaType,
        size: processed.fileSize,
        w: attachment.width ?? processed.width,
        h: attachment.height ?? processed.height,
      },
    };

    // Generate thumbnail if requested
    if (generateThumbnails && processed.mxcUrl !== undefined) {
      try {
        const { buffer } = await mediaProxy.downloadFromMatrix(processed.mxcUrl);
        const processor = getImageProcessor();
        const thumbnailBuffer = await processor.generateThumbnail(buffer, {
          width: thumbnailSize,
          height: thumbnailSize,
        });

        const thumbnailMxc = await mediaProxy.uploadToMatrix(thumbnailBuffer, 'image/jpeg');

        content.info = {
          ...content.info,
          thumbnail_url: thumbnailMxc,
          thumbnail_info: {
            mimetype: 'image/jpeg',
            size: thumbnailBuffer.length,
            w: thumbnailSize,
            h: thumbnailSize,
          },
        };
      } catch (error) {
        this.logger.warn('Failed to generate thumbnail', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return content;
  }
}

/**
 * Video media handler
 */
export class VideoHandler implements MediaHandler {
  private logger = bridgeLogger();

  async matrixToAP(
    content: MatrixMediaContent,
    context: MediaHandlerContext
  ): Promise<APAttachment> {
    const { mediaProxy } = context;

    const httpsUrl = mediaProxy.mxcToHttps(content.url);

    const attachment: APAttachment = {
      type: 'Video',
      mediaType: content.info?.mimetype ?? 'video/mp4',
      url: httpsUrl,
      name: content.body,
    };

    if (content.info?.w !== undefined) {
      attachment.width = content.info.w;
    }
    if (content.info?.h !== undefined) {
      attachment.height = content.info.h;
    }
    if (content.info?.duration !== undefined) {
      attachment.duration = Math.floor(content.info.duration / 1000); // Convert ms to seconds
    }

    return attachment;
  }

  async apToMatrix(
    attachment: APAttachment,
    context: MediaHandlerContext
  ): Promise<MatrixMediaContent> {
    const { mediaProxy } = context;

    const processed = await mediaProxy.httpsToMxc(attachment.url, {
      mimeType: attachment.mediaType,
      filename: attachment.name,
    });

    return {
      msgtype: 'm.video',
      body: attachment.name ?? 'video',
      url: processed.mxcUrl ?? '',
      info: {
        mimetype: attachment.mediaType,
        size: processed.fileSize,
        w: attachment.width,
        h: attachment.height,
        duration: attachment.duration !== undefined ? attachment.duration * 1000 : undefined,
      },
    };
  }
}

/**
 * Audio media handler
 */
export class AudioHandler implements MediaHandler {
  private logger = bridgeLogger();

  async matrixToAP(
    content: MatrixMediaContent,
    context: MediaHandlerContext
  ): Promise<APAttachment> {
    const { mediaProxy } = context;

    const httpsUrl = mediaProxy.mxcToHttps(content.url);

    const attachment: APAttachment = {
      type: 'Audio',
      mediaType: content.info?.mimetype ?? 'audio/mpeg',
      url: httpsUrl,
      name: content.body,
    };

    if (content.info?.duration !== undefined) {
      attachment.duration = Math.floor(content.info.duration / 1000);
    }

    return attachment;
  }

  async apToMatrix(
    attachment: APAttachment,
    context: MediaHandlerContext
  ): Promise<MatrixMediaContent> {
    const { mediaProxy } = context;

    const processed = await mediaProxy.httpsToMxc(attachment.url, {
      mimeType: attachment.mediaType,
      filename: attachment.name,
    });

    return {
      msgtype: 'm.audio',
      body: attachment.name ?? 'audio',
      url: processed.mxcUrl ?? '',
      info: {
        mimetype: attachment.mediaType,
        size: processed.fileSize,
        duration: attachment.duration !== undefined ? attachment.duration * 1000 : undefined,
      },
    };
  }
}

/**
 * File (document) media handler
 */
export class FileHandler implements MediaHandler {
  private logger = bridgeLogger();

  async matrixToAP(
    content: MatrixMediaContent,
    context: MediaHandlerContext
  ): Promise<APAttachment> {
    const { mediaProxy } = context;

    const httpsUrl = mediaProxy.mxcToHttps(content.url);

    return {
      type: 'Document',
      mediaType: content.info?.mimetype ?? 'application/octet-stream',
      url: httpsUrl,
      name: content.body,
    };
  }

  async apToMatrix(
    attachment: APAttachment,
    context: MediaHandlerContext
  ): Promise<MatrixMediaContent> {
    const { mediaProxy } = context;

    const processed = await mediaProxy.httpsToMxc(attachment.url, {
      mimeType: attachment.mediaType,
      filename: attachment.name,
    });

    return {
      msgtype: 'm.file',
      body: attachment.name ?? 'file',
      url: processed.mxcUrl ?? '',
      info: {
        mimetype: attachment.mediaType,
        size: processed.fileSize,
      },
    };
  }
}

/**
 * Media handler registry
 */
export class MediaHandlerRegistry {
  private handlers: Map<MediaType, MediaHandler> = new Map();

  constructor() {
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    this.handlers.set('image', new ImageHandler());
    this.handlers.set('video', new VideoHandler());
    this.handlers.set('audio', new AudioHandler());
    this.handlers.set('file', new FileHandler());
  }

  /**
   * Register a handler for a media type
   */
  register(type: MediaType, handler: MediaHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Get handler for a media type
   */
  get(type: MediaType): MediaHandler {
    return this.handlers.get(type) ?? this.handlers.get('file')!;
  }

  /**
   * Get handler for MIME type
   */
  getForMimeType(mimeType: string): MediaHandler {
    const mediaType = getMediaType(mimeType);
    return this.get(mediaType);
  }

  /**
   * Get handler for Matrix msgtype
   */
  getForMsgtype(msgtype: string): MediaHandler {
    switch (msgtype) {
      case 'm.image':
        return this.get('image');
      case 'm.video':
        return this.get('video');
      case 'm.audio':
        return this.get('audio');
      default:
        return this.get('file');
    }
  }

  /**
   * Get handler for AP attachment type
   */
  getForAPType(type: string): MediaHandler {
    switch (type) {
      case 'Image':
        return this.get('image');
      case 'Video':
        return this.get('video');
      case 'Audio':
        return this.get('audio');
      default:
        return this.get('file');
    }
  }
}

/**
 * Create default handler context
 */
export function createMediaHandlerContext(
  mediaProxy: MediaProxy,
  options?: {
    generateThumbnails?: boolean;
    generateBlurhash?: boolean;
    maxImageSize?: number;
    thumbnailSize?: number;
  }
): MediaHandlerContext {
  return {
    mediaProxy,
    generateThumbnails: options?.generateThumbnails ?? true,
    generateBlurhash: options?.generateBlurhash ?? true,
    maxImageSize: options?.maxImageSize ?? 10 * 1024 * 1024, // 10MB
    thumbnailSize: options?.thumbnailSize ?? 400,
  };
}

/**
 * Shared registry instance
 */
let sharedRegistry: MediaHandlerRegistry | null = null;

export function getMediaHandlerRegistry(): MediaHandlerRegistry {
  if (sharedRegistry === null) {
    sharedRegistry = new MediaHandlerRegistry();
  }
  return sharedRegistry;
}
