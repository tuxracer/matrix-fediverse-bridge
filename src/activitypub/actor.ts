import { type Request, type Response, type Router } from 'express';
import express from 'express';
import { generateKeyPairSync } from 'crypto';
import { activityPubLogger } from '../utils/logger.js';
import { ACTIVITY_CONTENT_TYPE, ActivityPubServer } from './server.js';

/**
 * ActivityPub Actor object
 */
export interface APActor {
  '@context': string | string[];
  id: string;
  type: 'Person' | 'Application' | 'Service';
  preferredUsername: string;
  name?: string;
  summary?: string;
  inbox: string;
  outbox: string;
  followers: string;
  following: string;
  url?: string;
  icon?: {
    type: 'Image';
    mediaType: string;
    url: string;
  };
  image?: {
    type: 'Image';
    mediaType: string;
    url: string;
  };
  publicKey: {
    id: string;
    owner: string;
    publicKeyPem: string;
  };
  endpoints?: {
    sharedInbox: string;
  };
  manuallyApprovesFollowers?: boolean;
  discoverable?: boolean;
  published?: string;
}

/**
 * Actor key pair
 */
export interface ActorKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Actor data from storage
 */
export interface ActorData {
  username: string;
  displayName?: string;
  summary?: string;
  avatarUrl?: string;
  headerUrl?: string;
  publicKeyPem: string;
  createdAt: Date;
}

/**
 * Actor lookup function
 */
export type ActorLookupFn = (username: string) => Promise<ActorData | null>;

/**
 * Actor key storage function
 */
export type ActorKeyStoreFn = (username: string, keyPair: ActorKeyPair) => Promise<void>;

/**
 * Actor key lookup function
 */
export type ActorKeyLookupFn = (username: string) => Promise<ActorKeyPair | null>;

/**
 * Generate a new RSA key pair for an actor
 */
export function generateActorKeyPair(): ActorKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

/**
 * Build an Actor object from actor data
 */
export function buildActorObject(
  domain: string,
  username: string,
  data: ActorData
): APActor {
  const baseUrl = `https://${domain}`;
  const actorUrl = `${baseUrl}/users/${username}`;

  const actor: APActor = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
    id: actorUrl,
    type: 'Person',
    preferredUsername: username,
    inbox: `${actorUrl}/inbox`,
    outbox: `${actorUrl}/outbox`,
    followers: `${actorUrl}/followers`,
    following: `${actorUrl}/following`,
    url: `${baseUrl}/@${username}`,
    publicKey: {
      id: `${actorUrl}#main-key`,
      owner: actorUrl,
      publicKeyPem: data.publicKeyPem,
    },
    endpoints: {
      sharedInbox: `${baseUrl}/inbox`,
    },
    manuallyApprovesFollowers: false,
    discoverable: true,
    published: data.createdAt.toISOString(),
  };

  if (data.displayName !== undefined) {
    actor.name = data.displayName;
  }

  if (data.summary !== undefined) {
    actor.summary = data.summary;
  }

  if (data.avatarUrl !== undefined) {
    actor.icon = {
      type: 'Image',
      mediaType: 'image/png', // TODO: detect actual media type
      url: data.avatarUrl,
    };
  }

  if (data.headerUrl !== undefined) {
    actor.image = {
      type: 'Image',
      mediaType: 'image/png',
      url: data.headerUrl,
    };
  }

  return actor;
}

/**
 * Create Actor routes
 */
export function createActorRouter(
  domain: string,
  lookupActor: ActorLookupFn,
  lookupKey: ActorKeyLookupFn,
  storeKey: ActorKeyStoreFn
): Router {
  const router = express.Router();
  const logger = activityPubLogger();

  /**
   * Get actor profile
   * GET /users/:username
   */
  router.get('/users/:username', async (req: Request, res: Response): Promise<void> => {
    const { username } = req.params;

    if (username === undefined) {
      res.status(400).json({ error: 'Missing username' });
      return;
    }

    logger.debug('Actor lookup', { username });

    // Check content negotiation
    if (!ActivityPubServer.acceptsActivityPub(req)) {
      // Redirect to profile page for HTML requests
      res.redirect(`https://${domain}/@${username}`);
      return;
    }

    // Look up actor
    const actorData = await lookupActor(username);
    if (actorData === null) {
      res.status(404).json({ error: 'Actor not found' });
      return;
    }

    // Ensure actor has a key pair
    let keyPair = await lookupKey(username);
    if (keyPair === null) {
      logger.info('Generating new key pair for actor', { username });
      keyPair = generateActorKeyPair();
      await storeKey(username, keyPair);
    }

    // Build actor object
    const actor = buildActorObject(domain, username, {
      ...actorData,
      publicKeyPem: keyPair.publicKeyPem,
    });

    res.setHeader('Content-Type', ACTIVITY_CONTENT_TYPE);
    res.setHeader('Cache-Control', 'max-age=180');
    res.json(actor);
  });

  /**
   * Get actor followers collection
   * GET /users/:username/followers
   */
  router.get('/users/:username/followers', async (req: Request, res: Response): Promise<void> => {
    const { username } = req.params;
    const page = req.query['page'] as string | undefined;

    if (username === undefined) {
      res.status(400).json({ error: 'Missing username' });
      return;
    }

    const actorUrl = `https://${domain}/users/${username}`;

    // TODO: Get actual follower count and list
    const totalItems = 0;

    if (page === undefined) {
      // Return collection summary
      res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${actorUrl}/followers`,
        type: 'OrderedCollection',
        totalItems,
        first: `${actorUrl}/followers?page=1`,
      });
    } else {
      // Return collection page
      res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${actorUrl}/followers?page=${page}`,
        type: 'OrderedCollectionPage',
        partOf: `${actorUrl}/followers`,
        totalItems,
        orderedItems: [],
      });
    }
  });

  /**
   * Get actor following collection
   * GET /users/:username/following
   */
  router.get('/users/:username/following', async (req: Request, res: Response): Promise<void> => {
    const { username } = req.params;
    const page = req.query['page'] as string | undefined;

    if (username === undefined) {
      res.status(400).json({ error: 'Missing username' });
      return;
    }

    const actorUrl = `https://${domain}/users/${username}`;

    // TODO: Get actual following count and list
    const totalItems = 0;

    if (page === undefined) {
      res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${actorUrl}/following`,
        type: 'OrderedCollection',
        totalItems,
        first: `${actorUrl}/following?page=1`,
      });
    } else {
      res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${actorUrl}/following?page=${page}`,
        type: 'OrderedCollectionPage',
        partOf: `${actorUrl}/following`,
        totalItems,
        orderedItems: [],
      });
    }
  });

  /**
   * Get actor outbox (public activities)
   * GET /users/:username/outbox
   */
  router.get('/users/:username/outbox', async (req: Request, res: Response): Promise<void> => {
    const { username } = req.params;
    const page = req.query['page'] as string | undefined;

    if (username === undefined) {
      res.status(400).json({ error: 'Missing username' });
      return;
    }

    const actorUrl = `https://${domain}/users/${username}`;

    // TODO: Get actual activity count and list
    const totalItems = 0;

    if (page === undefined) {
      res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${actorUrl}/outbox`,
        type: 'OrderedCollection',
        totalItems,
        first: `${actorUrl}/outbox?page=1`,
      });
    } else {
      res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${actorUrl}/outbox?page=${page}`,
        type: 'OrderedCollectionPage',
        partOf: `${actorUrl}/outbox`,
        totalItems,
        orderedItems: [],
      });
    }
  });

  return router;
}
