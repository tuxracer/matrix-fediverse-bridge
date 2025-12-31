import { type MatrixEvent } from '../matrix/appservice.js';
import { type MessageContent } from '../matrix/events.js';
import { type APObject, type APAttachment, type APTag } from '../activitypub/inbox.js';
import { type MediaProxy } from './media.js';
import { getMediaHandlerRegistry, createMediaHandlerContext, type MatrixMediaContent } from './mediaTypes.js';
import { getImageProcessor } from './imageProcessing.js';

/**
 * ActivityPub Note object for bridged messages
 */
export interface APNote extends APObject {
  type: 'Note';
  content: string;
  mediaType?: string;
  source?: {
    content: string;
    mediaType: string;
  };
  attachment?: APAttachment[];
  tag?: APTag[];
  inReplyTo?: string;
  sensitive?: boolean;
  summary?: string;
}

/**
 * Matrix message content for bridged messages
 */
export interface MatrixMessageContent {
  msgtype: string;
  body: string;
  format?: string;
  formatted_body?: string;
  url?: string;
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
  'm.relates_to'?: {
    'm.in_reply_to'?: {
      event_id: string;
    };
  };
}

/**
 * Transformation context
 */
export interface TransformContext {
  domain: string;
  baseUrl: string;
  lookupAPObjectId?: (matrixEventId: string) => Promise<string | null>;
  lookupMatrixEventId?: (apObjectId: string) => Promise<string | null>;
  convertMxcToHttps?: (mxcUrl: string) => string;
  convertHttpsToMxc?: (httpsUrl: string) => Promise<string>;
  getActorUrl?: (matrixUserId: string) => string;
  mediaProxy?: MediaProxy;
  generateBlurhash?: boolean;
  generateThumbnails?: boolean;
}

/**
 * Allowed HTML tags for Matrix
 */
const ALLOWED_MATRIX_TAGS = [
  'font', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'p', 'a', 'ul', 'ol', 'sup', 'sub',
  'li', 'b', 'i', 'u', 'strong', 'em', 'strike', 's',
  'code', 'hr', 'br', 'div', 'table', 'thead', 'tbody',
  'tr', 'th', 'td', 'caption', 'pre', 'span', 'img',
  'details', 'summary', 'mx-reply',
];

/**
 * Allowed HTML attributes for Matrix
 */
const ALLOWED_MATRIX_ATTRS: Record<string, string[]> = {
  'font': ['data-mx-bg-color', 'data-mx-color', 'color'],
  'span': ['data-mx-bg-color', 'data-mx-color', 'data-mx-spoiler'],
  'a': ['href', 'name', 'target', 'rel'],
  'img': ['width', 'height', 'alt', 'title', 'src'],
  'ol': ['start'],
  'code': ['class'],
};

/**
 * Transform a Matrix event to an ActivityPub Note
 */
export async function matrixToAP(
  event: MatrixEvent,
  content: MessageContent,
  context: TransformContext
): Promise<APNote> {
  const objectId = `${context.baseUrl}/objects/${encodeURIComponent(event.event_id)}`;
  const actorUrl = context.getActorUrl?.(event.sender) ?? `${context.baseUrl}/users/${encodeMatrixUserId(event.sender)}`;

  // Start building the Note
  const note: APNote = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: objectId,
    type: 'Note',
    attributedTo: actorUrl,
    content: '',
    published: new Date(event.origin_server_ts).toISOString(),
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [`${actorUrl}/followers`],
  };

  // Handle different message types
  if (content.msgtype === 'm.text' || content.msgtype === 'm.notice') {
    // Convert content
    if (content.formatted_body !== undefined && content.format === 'org.matrix.custom.html') {
      // Extract custom emoji from HTML before other transformations
      const { content: emojiProcessedContent, emojiTags } = extractCustomEmoji(content.formatted_body, context);
      note.content = transformMatrixHtmlToAP(emojiProcessedContent, context);
      note.source = {
        content: content.body,
        mediaType: 'text/plain',
      };

      // Add emoji tags if any were found
      if (emojiTags.length > 0) {
        note.tag = [...(note.tag ?? []), ...(emojiTags as unknown as APTag[])];
      }
    } else {
      note.content = escapeHtml(content.body);
    }

    // Transform mentions
    note.content = transformMatrixMentionsToAP(note.content, context.domain);
    const mentionTags = extractMentionTags(content.body, context);
    note.tag = [...(note.tag ?? []), ...mentionTags];
  } else if (content.msgtype === 'm.emote') {
    // Emotes are prefixed with the sender's name
    const displayName = event.sender.split(':')[0]?.slice(1) ?? 'Someone';
    note.content = `<em>${escapeHtml(displayName)} ${escapeHtml(content.body)}</em>`;
  }

  // Handle spoilers (content warnings)
  const spoilerMatch = content.formatted_body?.match(/data-mx-spoiler(?:="([^"]*)")?/);
  if (spoilerMatch !== null && spoilerMatch !== undefined) {
    note.sensitive = true;
    note.summary = spoilerMatch[1] ?? 'Spoiler';
  }

  // Handle replies
  const replyTo = content['m.relates_to']?.['m.in_reply_to']?.event_id;
  if (replyTo !== undefined && context.lookupAPObjectId !== undefined) {
    const apObjectId = await context.lookupAPObjectId(replyTo);
    if (apObjectId !== null) {
      note.inReplyTo = apObjectId;
    }
  }

  // Handle media attachments
  if (content.url !== undefined) {
    if (context.mediaProxy !== undefined) {
      // Use new media handler system
      const registry = getMediaHandlerRegistry();
      const handler = registry.getForMsgtype(content.msgtype);
      const handlerContext = createMediaHandlerContext(context.mediaProxy, {
        generateBlurhash: context.generateBlurhash ?? true,
        generateThumbnails: context.generateThumbnails ?? true,
      });

      try {
        const mediaContent: MatrixMediaContent = {
          msgtype: content.msgtype as 'm.image' | 'm.video' | 'm.audio' | 'm.file',
          body: content.body,
          url: content.url,
          info: content.info,
        };

        const apAttachment = await handler.matrixToAP(mediaContent, handlerContext);
        note.attachment = [apAttachment];
      } catch {
        // Fallback to simple conversion
        if (context.convertMxcToHttps !== undefined) {
          note.attachment = [buildSimpleAttachment(content, context)];
        }
      }
    } else if (context.convertMxcToHttps !== undefined) {
      note.attachment = [buildSimpleAttachment(content, context)];
    }
  }

  return note;
}

/**
 * Build a simple AP attachment without advanced processing
 */
function buildSimpleAttachment(content: MessageContent, context: TransformContext): APAttachment {
  const httpsUrl = context.convertMxcToHttps?.(content.url ?? '') ?? '';
  const attachment: APAttachment = {
    type: getAPMediaType(content.msgtype),
    url: httpsUrl,
    mediaType: content.info?.mimetype,
  };

  if (content.info?.w !== undefined) {
    attachment.width = content.info.w;
  }
  if (content.info?.h !== undefined) {
    attachment.height = content.info.h;
  }
  if (content.body !== undefined && content.body !== content.url) {
    attachment.name = content.body;
  }

  return attachment;
}

/**
 * Transform an ActivityPub Note to Matrix message content
 */
export async function apToMatrix(
  note: APObject,
  context: TransformContext
): Promise<MatrixMessageContent> {
  const message: MatrixMessageContent = {
    msgtype: 'm.text',
    body: '',
  };

  // Convert HTML content to plain text and Matrix HTML
  if (note.content !== undefined) {
    const sanitizedHtml = sanitizeHtmlForMatrix(note.content);
    const plainText = stripHtml(note.content);

    // Transform AP mentions to Matrix mentions
    let transformedHtml = transformAPMentionsToMatrix(sanitizedHtml, context.domain);
    let transformedPlain = transformAPMentionsToMatrix(plainText, context.domain);

    // Transform custom emoji from AP to Matrix format
    const emojiResult = transformAPEmojiToMatrix(transformedHtml, note.tag, context);
    transformedHtml = emojiResult.html;
    transformedPlain = transformAPEmojiToMatrix(transformedPlain, note.tag, context).text;

    message.body = transformedPlain;

    if (transformedHtml !== transformedPlain) {
      message.format = 'org.matrix.custom.html';
      message.formatted_body = transformedHtml;
    }
  }

  // Handle content warnings (convert to spoiler)
  if (note.sensitive === true && note.summary !== undefined) {
    const spoilerHtml = `<span data-mx-spoiler="${escapeHtml(note.summary)}">${message.formatted_body ?? escapeHtml(message.body)}</span>`;
    message.formatted_body = spoilerHtml;
    message.format = 'org.matrix.custom.html';
    message.body = `[${note.summary}] ${message.body}`;
  }

  // Handle replies
  if (note.inReplyTo !== undefined && context.lookupMatrixEventId !== undefined) {
    const matrixEventId = await context.lookupMatrixEventId(note.inReplyTo);
    if (matrixEventId !== null) {
      message['m.relates_to'] = {
        'm.in_reply_to': {
          event_id: matrixEventId,
        },
      };
    }
  }

  return message;
}

/**
 * Transform AP attachments to Matrix media messages
 * Returns array of Matrix message contents for each attachment
 */
export async function apAttachmentsToMatrix(
  attachments: APAttachment[],
  context: TransformContext
): Promise<MatrixMessageContent[]> {
  const messages: MatrixMessageContent[] = [];

  if (context.mediaProxy === undefined) {
    // Without media proxy, just return text references
    for (const attachment of attachments) {
      messages.push({
        msgtype: 'm.text',
        body: attachment.name ?? attachment.url ?? 'Attachment',
      });
    }
    return messages;
  }

  const registry = getMediaHandlerRegistry();
  const handlerContext = createMediaHandlerContext(context.mediaProxy, {
    generateBlurhash: context.generateBlurhash ?? true,
    generateThumbnails: context.generateThumbnails ?? true,
  });

  for (const attachment of attachments) {
    try {
      const handler = registry.getForAPType(attachment.type);
      const matrixContent = await handler.apToMatrix(
        {
          type: attachment.type as 'Image' | 'Video' | 'Audio' | 'Document',
          mediaType: attachment.mediaType ?? 'application/octet-stream',
          url: attachment.url ?? '',
          name: attachment.name,
          width: attachment.width,
          height: attachment.height,
          blurhash: attachment.blurhash,
        },
        handlerContext
      );

      messages.push({
        msgtype: matrixContent.msgtype,
        body: matrixContent.body,
        url: matrixContent.url,
        info: matrixContent.info as MatrixMessageContent['info'],
      } as unknown as MatrixMessageContent);
    } catch {
      // Fallback: just send the URL as text
      messages.push({
        msgtype: 'm.text',
        body: attachment.name ?? attachment.url ?? 'Attachment',
      });
    }
  }

  return messages;
}

/**
 * Transform Matrix HTML to ActivityPub-compatible HTML
 */
function transformMatrixHtmlToAP(html: string, context: TransformContext): string {
  // Remove mx-reply blocks (reply fallback)
  let result = html.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, '');

  // Convert Matrix-specific attributes
  result = result.replace(/data-mx-color="([^"]+)"/g, 'style="color: $1"');
  result = result.replace(/data-mx-bg-color="([^"]+)"/g, 'style="background-color: $1"');

  // Convert MXC URLs in images
  if (context.convertMxcToHttps !== undefined) {
    result = result.replace(/src="(mxc:\/\/[^"]+)"/g, (_match, mxc: string) => {
      const https = context.convertMxcToHttps?.(mxc) ?? mxc;
      return `src="${https}"`;
    });
  }

  return result;
}

/**
 * Sanitize HTML for Matrix (allowlist approach)
 */
function sanitizeHtmlForMatrix(html: string): string {
  // This is a simplified sanitizer - in production use a proper library like DOMPurify
  let result = html;

  // Remove script tags and event handlers
  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  result = result.replace(/\bon\w+\s*=\s*"[^"]*"/gi, '');
  result = result.replace(/\bon\w+\s*=\s*'[^']*'/gi, '');

  // Remove style tags
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove dangerous protocols in links
  result = result.replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"');
  result = result.replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");

  return result;
}

/**
 * Strip HTML tags to get plain text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Transform Matrix mentions (@user:server) to AP format (@user@server)
 */
function transformMatrixMentionsToAP(content: string, _domain: string): string {
  // Match Matrix user IDs: @localpart:server.tld
  return content.replace(
    /@([a-zA-Z0-9._=-]+):([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    '@$1@$2'
  );
}

/**
 * Transform AP mentions (@user@server) to Matrix format
 */
function transformAPMentionsToMatrix(content: string, bridgeDomain: string): string {
  // Match AP handles: @user@server.tld
  return content.replace(
    /@([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    (match, user: string, server: string) => {
      // If it's from our bridge domain, convert to Matrix format
      if (server === bridgeDomain) {
        return `@${user}:${server}`;
      }
      // Keep external mentions as-is or convert to ghost user format
      return `@_ap_${user}_${server.replace(/\./g, '_')}:${bridgeDomain}`;
    }
  );
}

/**
 * Extract mention tags from content
 */
function extractMentionTags(body: string, context: TransformContext): APTag[] {
  const tags: APTag[] = [];
  const mentionRegex = /@([a-zA-Z0-9._=-]+):([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  let match;

  while ((match = mentionRegex.exec(body)) !== null) {
    if (match[1] !== undefined && match[2] !== undefined) {
      const [, localpart, server] = match;
      tags.push({
        type: 'Mention',
        name: `@${localpart}@${server}`,
        href: `https://${server}/users/${localpart}`,
      });
    }
  }

  // Extract hashtags
  const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
  while ((match = hashtagRegex.exec(body)) !== null) {
    if (match[1] !== undefined) {
      tags.push({
        type: 'Hashtag',
        name: `#${match[1]}`,
        href: `${context.baseUrl}/tags/${match[1]}`,
      });
    }
  }

  return tags;
}

/**
 * Custom emoji representation in ActivityPub
 */
export interface APEmoji {
  type: 'Emoji';
  id: string;
  name: string;
  icon: {
    type: 'Image';
    mediaType: string;
    url: string;
  };
}

/**
 * Extract custom emoji shortcodes from Matrix content
 * Matrix custom emoji are in the format :shortcode: with an associated image
 */
function extractCustomEmoji(
  html: string,
  context: TransformContext
): { content: string; emojiTags: APEmoji[] } {
  const emojiTags: APEmoji[] = [];

  // Match Matrix custom emoji images: <img data-mx-emoticon src="mxc://..." alt=":shortcode:" ...>
  const emojiRegex = /<img[^>]*data-mx-emoticon[^>]*src="(mxc:\/\/[^"]+)"[^>]*alt=":([^:]+):"[^>]*>/gi;

  const content = html.replace(emojiRegex, (match, mxcUrl: string, shortcode: string) => {
    // Convert MXC URL to HTTPS if converter available
    const httpsUrl = context.convertMxcToHttps?.(mxcUrl) ?? mxcUrl;

    // Add emoji tag
    emojiTags.push({
      type: 'Emoji',
      id: `${context.baseUrl}/emoji/${encodeURIComponent(shortcode)}`,
      name: `:${shortcode}:`,
      icon: {
        type: 'Image',
        mediaType: 'image/png', // Default, could be detected
        url: httpsUrl,
      },
    });

    // Replace image with shortcode text for AP (will be rendered by the receiving server)
    return `:${shortcode}:`;
  });

  return { content, emojiTags };
}

/**
 * Transform ActivityPub custom emoji to Matrix format
 * AP emoji are represented as Emoji tags with icon URLs
 */
function transformAPEmojiToMatrix(
  content: string,
  tags: APTag[] | undefined,
  context: TransformContext
): { text: string; html: string } {
  if (tags === undefined || tags.length === 0) {
    return { text: content, html: content };
  }

  // Filter emoji tags
  const emojiTags = tags.filter((tag): tag is APTag & { icon: { url: string } } =>
    tag.type === 'Emoji' && tag.name !== undefined && 'icon' in tag
  );

  if (emojiTags.length === 0) {
    return { text: content, html: content };
  }

  let html = content;
  let text = content;

  for (const emoji of emojiTags) {
    const shortcode = emoji.name; // e.g., ":blobcat:"
    const iconUrl = (emoji as unknown as { icon: { url: string } }).icon.url;

    // In HTML, replace shortcode with image
    const imgTag = `<img data-mx-emoticon height="32" src="${escapeHtml(iconUrl)}" alt="${escapeHtml(shortcode)}" title="${escapeHtml(shortcode)}">`;
    html = html.replace(new RegExp(escapeRegExp(shortcode), 'g'), imgTag);

    // Keep shortcode in plain text
    // (text remains unchanged for this emoji)
  }

  return { text, html };
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get ActivityPub media type from Matrix msgtype
 */
function getAPMediaType(msgtype: string): string {
  switch (msgtype) {
    case 'm.image':
      return 'Image';
    case 'm.video':
      return 'Video';
    case 'm.audio':
      return 'Audio';
    case 'm.file':
    default:
      return 'Document';
  }
}

/**
 * Encode a Matrix user ID for use in URLs
 */
function encodeMatrixUserId(userId: string): string {
  // Remove @ prefix and encode
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  const [localpart, server] = withoutPrefix.split(':');
  return `${localpart}_${server}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Create a deterministic AP object ID from a Matrix event
 */
export function generateAPObjectId(baseUrl: string, matrixEventId: string): string {
  return `${baseUrl}/objects/${encodeURIComponent(matrixEventId)}`;
}

/**
 * Create a deterministic AP activity ID
 */
export function generateAPActivityId(baseUrl: string, type: string, objectId: string): string {
  const hash = Buffer.from(objectId).toString('base64url').slice(0, 16);
  return `${baseUrl}/activities/${type.toLowerCase()}-${hash}`;
}
