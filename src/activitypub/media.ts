import { Router, type Request, type Response } from 'express';
import { MediaProxy, type MediaConfig } from '../bridge/media.js';
import { activityPubLogger } from '../utils/logger.js';
import * as mediaRepo from '../db/repositories/media.js';

/**
 * Media route parameters
 */
interface MediaParams {
  serverName: string;
  mediaId: string;
}

/**
 * Create media routes for ActivityPub server
 */
export function createMediaRoutes(mediaProxy: MediaProxy): Router {
  const router = Router();
  const logger = activityPubLogger();

  /**
   * GET /media/:serverName/:mediaId
   * Proxy Matrix media for ActivityPub clients
   */
  router.get(
    '/media/:serverName/:mediaId',
    async (req: Request<MediaParams>, res: Response) => {
      const { serverName, mediaId } = req.params;

      try {
        // Reconstruct MXC URL
        const mxcUrl = `mxc://${decodeURIComponent(serverName)}/${decodeURIComponent(mediaId)}`;

        logger.debug('Media proxy request', { mxcUrl });

        // Download from Matrix
        const { buffer, mimeType, filename } = await mediaProxy.downloadFromMatrix(mxcUrl);

        // Set response headers
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', buffer.length.toString());
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours

        if (filename !== undefined) {
          res.setHeader(
            'Content-Disposition',
            `inline; filename="${filename.replace(/"/g, '\\"')}"`
          );
        }

        // Send buffer
        res.send(buffer);
      } catch (error) {
        logger.error('Media proxy failed', {
          serverName,
          mediaId,
          error: error instanceof Error ? error.message : String(error),
        });

        res.status(404).json({ error: 'Media not found' });
      }
    }
  );

  /**
   * GET /media/:serverName/:mediaId/thumbnail
   * Serve thumbnail for image media
   */
  router.get(
    '/media/:serverName/:mediaId/thumbnail',
    async (req: Request<MediaParams>, res: Response) => {
      const { serverName, mediaId } = req.params;
      const width = parseInt(req.query.width as string, 10) || 400;
      const height = parseInt(req.query.height as string, 10) || 400;

      try {
        const mxcUrl = `mxc://${decodeURIComponent(serverName)}/${decodeURIComponent(mediaId)}`;

        logger.debug('Thumbnail request', { mxcUrl, width, height });

        // Download from Matrix
        const { buffer, mimeType } = await mediaProxy.downloadFromMatrix(mxcUrl);

        // Only generate thumbnails for images
        if (!mimeType.startsWith('image/')) {
          res.status(400).json({ error: 'Thumbnails only available for images' });
          return;
        }

        // Generate thumbnail
        const thumbnail = await mediaProxy.generateThumbnail(buffer, width, height);

        // Set response headers
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', thumbnail.length.toString());
        res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days

        res.send(thumbnail);
      } catch (error) {
        logger.error('Thumbnail generation failed', {
          serverName,
          mediaId,
          error: error instanceof Error ? error.message : String(error),
        });

        res.status(404).json({ error: 'Media not found' });
      }
    }
  );

  /**
   * GET /media/info/:id
   * Get media metadata by ID
   */
  router.get('/media/info/:id', async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    try {
      const media = await mediaRepo.findById(id);

      if (media === null) {
        res.status(404).json({ error: 'Media not found' });
        return;
      }

      res.json({
        id: media.id,
        mimeType: media.mime_type,
        fileSize: media.file_size,
        width: media.width,
        height: media.height,
        blurhash: media.blurhash,
        altText: media.alt_text,
        createdAt: media.created_at,
      });
    } catch (error) {
      logger.error('Media info lookup failed', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /media/stats
   * Get media cache statistics
   */
  router.get('/media/stats', async (_req: Request, res: Response) => {
    try {
      const [totalCount, totalSize] = await Promise.all([
        mediaRepo.countAll(),
        mediaRepo.getTotalSize(),
      ]);

      const cacheStats = mediaProxy.getCacheStats();

      res.json({
        database: {
          totalMedia: totalCount,
          totalSize,
        },
        cache: cacheStats,
      });
    } catch (error) {
      logger.error('Media stats failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

/**
 * Create a MediaProxy instance from config
 */
export function createMediaProxy(config: {
  maxFileSize?: number;
  matrixHomeserverUrl: string;
  matrixAccessToken: string;
  apBaseUrl: string;
}): MediaProxy {
  const mediaConfig: MediaConfig = {
    maxFileSize: config.maxFileSize ?? 50 * 1024 * 1024, // 50MB default
    thumbnailSize: 400,
    allowedMimeTypes: [], // Use defaults
    matrixHomeserverUrl: config.matrixHomeserverUrl,
    matrixAccessToken: config.matrixAccessToken,
    apBaseUrl: config.apBaseUrl,
  };

  return new MediaProxy(mediaConfig);
}
