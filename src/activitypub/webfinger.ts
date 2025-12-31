import { type Request, type Response, type Router } from 'express';
import express from 'express';
import { activityPubLogger } from '../utils/logger.js';
import { ACTIVITY_CONTENT_TYPE } from './server.js';

/**
 * WebFinger JRD (JSON Resource Descriptor) response
 */
export interface WebFingerResponse {
  subject: string;
  aliases?: string[];
  links: WebFingerLink[];
}

/**
 * WebFinger link
 */
export interface WebFingerLink {
  rel: string;
  type?: string;
  href?: string;
  template?: string;
}

/**
 * User lookup function type
 */
export type UserLookupFn = (
  username: string,
  domain: string
) => Promise<{ actorUrl: string; profileUrl?: string } | null>;

/**
 * Create WebFinger routes
 */
export function createWebFingerRouter(
  domain: string,
  lookupUser: UserLookupFn
): Router {
  const router = express.Router();
  const logger = activityPubLogger();

  /**
   * WebFinger endpoint
   * GET /.well-known/webfinger?resource=acct:user@domain
   */
  router.get('/.well-known/webfinger', async (req: Request, res: Response): Promise<void> => {
    const resource = req.query['resource'] as string | undefined;

    if (resource === undefined) {
      res.status(400).json({ error: 'Missing resource parameter' });
      return;
    }

    logger.debug('WebFinger lookup', { resource });

    // Parse the resource (acct:user@domain format)
    const parsed = parseAcctUri(resource);
    if (parsed === null) {
      res.status(400).json({ error: 'Invalid resource format. Expected acct:user@domain' });
      return;
    }

    const { username, host } = parsed;

    // Verify this is our domain
    if (host !== domain) {
      logger.debug('WebFinger lookup for foreign domain', { host, ourDomain: domain });
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Look up the user
    const user = await lookupUser(username, domain);

    if (user === null) {
      logger.debug('WebFinger user not found', { username, domain });
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Build WebFinger response
    const response: WebFingerResponse = {
      subject: `acct:${username}@${domain}`,
      aliases: [user.actorUrl],
      links: [
        {
          rel: 'self',
          type: ACTIVITY_CONTENT_TYPE,
          href: user.actorUrl,
        },
      ],
    };

    // Add profile page link if available
    if (user.profileUrl !== undefined) {
      response.links.push({
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: user.profileUrl,
      });
    }

    // Set cache headers
    res.setHeader('Cache-Control', 'max-age=3600');
    res.setHeader('Content-Type', 'application/jrd+json');

    res.json(response);
  });

  /**
   * Host-meta endpoint (optional but recommended)
   * GET /.well-known/host-meta
   */
  router.get('/.well-known/host-meta', (_req: Request, res: Response): void => {
    res.setHeader('Content-Type', 'application/xrd+xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Link rel="lrdd" template="https://${domain}/.well-known/webfinger?resource={uri}"/>
</XRD>`);
  });

  /**
   * NodeInfo discovery endpoint
   * GET /.well-known/nodeinfo
   */
  router.get('/.well-known/nodeinfo', (_req: Request, res: Response): void => {
    res.setHeader('Content-Type', 'application/json');
    res.json({
      links: [
        {
          rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
          href: `https://${domain}/nodeinfo/2.1`,
        },
      ],
    });
  });

  return router;
}

/**
 * Create NodeInfo endpoint
 */
export function createNodeInfoRouter(
  domain: string,
  getStats: () => Promise<{ users: number; posts: number }>
): Router {
  const router = express.Router();

  /**
   * NodeInfo 2.1 endpoint
   * GET /nodeinfo/2.1
   */
  router.get('/nodeinfo/2.1', async (_req: Request, res: Response): Promise<void> => {
    const stats = await getStats();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'max-age=1800');

    res.json({
      version: '2.1',
      software: {
        name: 'matrix-activitypub-bridge',
        version: '0.1.0',
        repository: 'https://github.com/example/matrix-activitypub-bridge',
      },
      protocols: ['activitypub'],
      usage: {
        users: {
          total: stats.users,
          activeMonth: stats.users,
          activeHalfyear: stats.users,
        },
        localPosts: stats.posts,
      },
      openRegistrations: false,
      metadata: {
        nodeName: `Matrix-ActivityPub Bridge (${domain})`,
        nodeDescription: 'Bridge between Matrix and the Fediverse',
      },
    });
  });

  return router;
}

/**
 * Parse an acct: URI
 * Formats: acct:user@domain or @user@domain or user@domain
 */
function parseAcctUri(uri: string): { username: string; host: string } | null {
  // Remove acct: prefix if present
  let normalized = uri;
  if (normalized.startsWith('acct:')) {
    normalized = normalized.slice(5);
  }

  // Remove leading @ if present
  if (normalized.startsWith('@')) {
    normalized = normalized.slice(1);
  }

  // Split on @
  const parts = normalized.split('@');
  if (parts.length !== 2) {
    return null;
  }

  const [username, host] = parts;
  if (username === undefined || host === undefined || username === '' || host === '') {
    return null;
  }

  return { username, host };
}
