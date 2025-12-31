import { createHash, createSign, createVerify } from 'crypto';
import { type Request } from 'express';
import { activityPubLogger } from '../utils/logger.js';

/**
 * HTTP Signature algorithm
 */
export type SignatureAlgorithm = 'rsa-sha256' | 'rsa-sha512';

/**
 * Parsed HTTP Signature
 */
export interface ParsedSignature {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
}

/**
 * Signing options
 */
export interface SigningOptions {
  keyId: string;
  privateKey: string;
  algorithm?: SignatureAlgorithm;
  headers?: string[];
}

/**
 * Signed request headers
 */
export interface SignedHeaders {
  Signature: string;
  Date: string;
  Digest?: string;
  Host: string;
}

/**
 * Public key cache entry
 */
interface KeyCacheEntry {
  publicKey: string;
  fetchedAt: number;
}

/**
 * Public key fetch function
 */
export type FetchPublicKeyFn = (keyId: string) => Promise<string | null>;

/**
 * HTTP Signature manager
 */
export class SignatureManager {
  private keyCache: Map<string, KeyCacheEntry> = new Map();
  private readonly cacheTTL = 3600000; // 1 hour
  private readonly maxClockDrift = 30000; // 30 seconds
  private fetchPublicKey: FetchPublicKeyFn | null = null;

  /**
   * Set the public key fetch function
   */
  onFetchPublicKey(fn: FetchPublicKeyFn): void {
    this.fetchPublicKey = fn;
  }

  /**
   * Sign an outbound request
   */
  signRequest(
    method: string,
    url: string,
    body: string | Buffer | undefined,
    options: SigningOptions
  ): SignedHeaders {
    const parsedUrl = new URL(url);
    const algorithm = options.algorithm ?? 'rsa-sha256';
    const headersToSign = options.headers ?? ['(request-target)', 'host', 'date', 'digest'];

    // Generate Date header
    const date = new Date().toUTCString();

    // Generate Digest header if body present
    let digest: string | undefined;
    if (body !== undefined) {
      const hash = createHash('sha256').update(body).digest('base64');
      digest = `SHA-256=${hash}`;
    }

    // Build signing string
    const signingParts: string[] = [];
    for (const header of headersToSign) {
      switch (header) {
        case '(request-target)':
          signingParts.push(`(request-target): ${method.toLowerCase()} ${parsedUrl.pathname}${parsedUrl.search}`);
          break;
        case 'host':
          signingParts.push(`host: ${parsedUrl.host}`);
          break;
        case 'date':
          signingParts.push(`date: ${date}`);
          break;
        case 'digest':
          if (digest !== undefined) {
            signingParts.push(`digest: ${digest}`);
          }
          break;
        default:
          // Other headers would be added here
          break;
      }
    }

    const signingString = signingParts.join('\n');

    // Sign the string
    const signer = createSign(algorithm === 'rsa-sha512' ? 'sha512' : 'sha256');
    signer.update(signingString);
    const signature = signer.sign(options.privateKey, 'base64');

    // Build Signature header
    const signatureHeader = [
      `keyId="${options.keyId}"`,
      `algorithm="${algorithm}"`,
      `headers="${headersToSign.join(' ')}"`,
      `signature="${signature}"`,
    ].join(',');

    const result: SignedHeaders = {
      Signature: signatureHeader,
      Date: date,
      Host: parsedUrl.host,
    };

    if (digest !== undefined) {
      result.Digest = digest;
    }

    return result;
  }

  /**
   * Verify an incoming request signature
   */
  async verifyRequest(req: Request, body: string | Buffer): Promise<boolean> {
    const logger = activityPubLogger();

    // Parse Signature header
    const signatureHeader = req.headers['signature'] as string | undefined;
    if (signatureHeader === undefined) {
      logger.debug('No Signature header present');
      return false;
    }

    const parsed = this.parseSignatureHeader(signatureHeader);
    if (parsed === null) {
      logger.debug('Failed to parse Signature header');
      return false;
    }

    // Verify Date header (clock drift check)
    const dateHeader = req.headers['date'] as string | undefined;
    if (dateHeader !== undefined) {
      const requestDate = new Date(dateHeader).getTime();
      const now = Date.now();
      if (Math.abs(now - requestDate) > this.maxClockDrift) {
        logger.warn('Request date outside acceptable drift', {
          requestDate: dateHeader,
          drift: Math.abs(now - requestDate),
        });
        return false;
      }
    }

    // Verify Digest header if present
    const digestHeader = req.headers['digest'] as string | undefined;
    if (digestHeader !== undefined) {
      if (!this.verifyDigest(body, digestHeader)) {
        logger.warn('Digest verification failed');
        return false;
      }
    }

    // Get public key
    const publicKey = await this.getPublicKey(parsed.keyId);
    if (publicKey === null) {
      logger.warn('Failed to fetch public key', { keyId: parsed.keyId });
      return false;
    }

    // Build signing string
    const signingString = this.buildSigningString(req, parsed.headers);

    // Verify signature
    try {
      const algorithm = parsed.algorithm.includes('sha512') ? 'sha512' : 'sha256';
      const verifier = createVerify(algorithm);
      verifier.update(signingString);

      const isValid = verifier.verify(publicKey, parsed.signature, 'base64');

      if (!isValid) {
        logger.debug('Signature verification failed');
      }

      return isValid;
    } catch (error) {
      logger.error('Signature verification error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Parse the Signature header
   */
  private parseSignatureHeader(header: string): ParsedSignature | null {
    const parts: Record<string, string> = {};

    // Parse key="value" pairs
    const regex = /(\w+)="([^"]+)"/g;
    let match;
    while ((match = regex.exec(header)) !== null) {
      if (match[1] !== undefined && match[2] !== undefined) {
        parts[match[1]] = match[2];
      }
    }

    const keyId = parts['keyId'];
    const algorithm = parts['algorithm'];
    const headersStr = parts['headers'];
    const signature = parts['signature'];

    if (
      keyId === undefined ||
      algorithm === undefined ||
      headersStr === undefined ||
      signature === undefined
    ) {
      return null;
    }

    return {
      keyId,
      algorithm,
      headers: headersStr.split(' '),
      signature,
    };
  }

  /**
   * Build the signing string from request headers
   */
  private buildSigningString(req: Request, headers: string[]): string {
    const parts: string[] = [];

    for (const header of headers) {
      if (header === '(request-target)') {
        parts.push(`(request-target): ${req.method.toLowerCase()} ${req.originalUrl}`);
      } else {
        const value = req.headers[header.toLowerCase()];
        if (value !== undefined) {
          parts.push(`${header.toLowerCase()}: ${Array.isArray(value) ? value[0] : value}`);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Verify the Digest header matches the body
   */
  private verifyDigest(body: string | Buffer, digestHeader: string): boolean {
    // Parse digest header (format: algorithm=base64hash)
    const match = digestHeader.match(/^(\w+-\d+)=(.+)$/);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      return false;
    }

    const [, algorithm, expectedHash] = match;

    // Only support SHA-256 for now
    if (algorithm !== 'SHA-256') {
      activityPubLogger().warn('Unsupported digest algorithm', { algorithm });
      return false;
    }

    const actualHash = createHash('sha256').update(body).digest('base64');
    return actualHash === expectedHash;
  }

  /**
   * Get a public key, using cache or fetching if needed
   */
  private async getPublicKey(keyId: string): Promise<string | null> {
    const logger = activityPubLogger();

    // Check cache
    const cached = this.keyCache.get(keyId);
    if (cached !== undefined && Date.now() - cached.fetchedAt < this.cacheTTL) {
      return cached.publicKey;
    }

    // Fetch public key
    if (this.fetchPublicKey === null) {
      logger.warn('No public key fetch function configured');
      return null;
    }

    const publicKey = await this.fetchPublicKey(keyId);
    if (publicKey === null) {
      return null;
    }

    // Update cache
    this.keyCache.set(keyId, {
      publicKey,
      fetchedAt: Date.now(),
    });

    // Clean up old cache entries
    this.cleanupCache();

    return publicKey;
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [keyId, entry] of this.keyCache) {
      if (now - entry.fetchedAt > this.cacheTTL) {
        this.keyCache.delete(keyId);
      }
    }
  }

  /**
   * Invalidate a cached public key (e.g., after verification failure)
   */
  invalidateKey(keyId: string): void {
    this.keyCache.delete(keyId);
  }

  /**
   * Clear the entire key cache
   */
  clearCache(): void {
    this.keyCache.clear();
  }
}

/**
 * Generate a Digest header for a body
 */
export function generateDigest(body: string | Buffer): string {
  const hash = createHash('sha256').update(body).digest('base64');
  return `SHA-256=${hash}`;
}
