import { type MatrixEvent } from './appservice.js';
import { matrixLogger } from '../utils/logger.js';
import { type PuppetManager } from './puppet.js';

/**
 * Message content from m.room.message events
 */
export interface MessageContent {
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
  };
  'm.relates_to'?: {
    rel_type?: string;
    event_id?: string;
    'm.in_reply_to'?: {
      event_id: string;
    };
    key?: string; // For reactions
  };
}

/**
 * Member content from m.room.member events
 */
export interface MemberContent {
  membership: 'join' | 'leave' | 'invite' | 'ban' | 'knock';
  displayname?: string;
  avatar_url?: string;
}

/**
 * Reaction content from m.reaction events
 */
export interface ReactionContent {
  'm.relates_to': {
    rel_type: 'm.annotation';
    event_id: string;
    key: string;
  };
}

/**
 * Callback types for handling different event types
 */
export type MessageHandler = (
  event: MatrixEvent,
  content: MessageContent
) => Promise<void>;

export type MemberHandler = (
  event: MatrixEvent,
  content: MemberContent
) => Promise<void>;

export type ReactionHandler = (
  event: MatrixEvent,
  content: ReactionContent
) => Promise<void>;

export type RedactionHandler = (event: MatrixEvent) => Promise<void>;

/**
 * Handles Matrix events and dispatches them to appropriate handlers
 */
export class EventProcessor {
  private puppetManager: PuppetManager;
  private botUserId: string;

  // Event handlers
  private textMessageHandlers: MessageHandler[] = [];
  private imageMessageHandlers: MessageHandler[] = [];
  private videoMessageHandlers: MessageHandler[] = [];
  private audioMessageHandlers: MessageHandler[] = [];
  private fileMessageHandlers: MessageHandler[] = [];
  private memberJoinHandlers: MemberHandler[] = [];
  private memberLeaveHandlers: MemberHandler[] = [];
  private memberInviteHandlers: MemberHandler[] = [];
  private reactionHandlers: ReactionHandler[] = [];
  private redactionHandlers: RedactionHandler[] = [];

  constructor(puppetManager: PuppetManager, botUserId: string) {
    this.puppetManager = puppetManager;
    this.botUserId = botUserId;
  }

  /**
   * Process an incoming Matrix event
   */
  async processEvent(event: MatrixEvent): Promise<void> {
    const logger = matrixLogger();

    // Skip events from our own ghost users or bot
    if (this.shouldIgnoreEvent(event)) {
      logger.debug('Ignoring event from bridge user', {
        eventId: event.event_id,
        sender: event.sender,
      });
      return;
    }

    // Route event to appropriate handler
    try {
      switch (event.type) {
        case 'm.room.message':
          await this.handleRoomMessage(event);
          break;

        case 'm.room.member':
          await this.handleRoomMember(event);
          break;

        case 'm.reaction':
          await this.handleReaction(event);
          break;

        case 'm.room.redaction':
          await this.handleRedaction(event);
          break;

        default:
          logger.debug('Unhandled event type', {
            type: event.type,
            eventId: event.event_id,
          });
      }
    } catch (error) {
      logger.error('Error processing event', {
        eventId: event.event_id,
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if we should ignore this event (to prevent loops)
   */
  private shouldIgnoreEvent(event: MatrixEvent): boolean {
    // Ignore events from our bot
    if (event.sender === this.botUserId) {
      return true;
    }

    // Ignore events from our ghost users
    if (this.puppetManager.isGhostUser(event.sender)) {
      return true;
    }

    return false;
  }

  /**
   * Handle m.room.message events
   */
  private async handleRoomMessage(event: MatrixEvent): Promise<void> {
    const content = event.content as unknown as MessageContent;
    const msgtype = content.msgtype;

    const logger = matrixLogger();
    logger.debug('Processing room message', {
      eventId: event.event_id,
      msgtype,
    });

    switch (msgtype) {
      case 'm.text':
      case 'm.notice':
      case 'm.emote':
        for (const handler of this.textMessageHandlers) {
          await handler(event, content);
        }
        break;

      case 'm.image':
        for (const handler of this.imageMessageHandlers) {
          await handler(event, content);
        }
        break;

      case 'm.video':
        for (const handler of this.videoMessageHandlers) {
          await handler(event, content);
        }
        break;

      case 'm.audio':
        for (const handler of this.audioMessageHandlers) {
          await handler(event, content);
        }
        break;

      case 'm.file':
        for (const handler of this.fileMessageHandlers) {
          await handler(event, content);
        }
        break;

      default:
        logger.debug('Unhandled message type', { msgtype });
    }
  }

  /**
   * Handle m.room.member events
   */
  private async handleRoomMember(event: MatrixEvent): Promise<void> {
    const content = event.content as unknown as MemberContent;
    const membership = content.membership;

    const logger = matrixLogger();
    logger.debug('Processing room member event', {
      eventId: event.event_id,
      membership,
      stateKey: event.state_key,
    });

    switch (membership) {
      case 'join':
        for (const handler of this.memberJoinHandlers) {
          await handler(event, content);
        }
        break;

      case 'leave':
        for (const handler of this.memberLeaveHandlers) {
          await handler(event, content);
        }
        break;

      case 'invite':
        for (const handler of this.memberInviteHandlers) {
          await handler(event, content);
        }
        break;

      default:
        logger.debug('Unhandled membership type', { membership });
    }
  }

  /**
   * Handle m.reaction events
   */
  private async handleReaction(event: MatrixEvent): Promise<void> {
    const content = event.content as unknown as ReactionContent;

    const logger = matrixLogger();
    logger.debug('Processing reaction', {
      eventId: event.event_id,
      targetEvent: content['m.relates_to'].event_id,
      key: content['m.relates_to'].key,
    });

    for (const handler of this.reactionHandlers) {
      await handler(event, content);
    }
  }

  /**
   * Handle m.room.redaction events
   */
  private async handleRedaction(event: MatrixEvent): Promise<void> {
    const logger = matrixLogger();
    logger.debug('Processing redaction', {
      eventId: event.event_id,
      redacts: event.content['redacts'] as string | undefined,
    });

    for (const handler of this.redactionHandlers) {
      await handler(event);
    }
  }

  // Handler registration methods
  onTextMessage(handler: MessageHandler): void {
    this.textMessageHandlers.push(handler);
  }

  onImageMessage(handler: MessageHandler): void {
    this.imageMessageHandlers.push(handler);
  }

  onVideoMessage(handler: MessageHandler): void {
    this.videoMessageHandlers.push(handler);
  }

  onAudioMessage(handler: MessageHandler): void {
    this.audioMessageHandlers.push(handler);
  }

  onFileMessage(handler: MessageHandler): void {
    this.fileMessageHandlers.push(handler);
  }

  onMemberJoin(handler: MemberHandler): void {
    this.memberJoinHandlers.push(handler);
  }

  onMemberLeave(handler: MemberHandler): void {
    this.memberLeaveHandlers.push(handler);
  }

  onMemberInvite(handler: MemberHandler): void {
    this.memberInviteHandlers.push(handler);
  }

  onReaction(handler: ReactionHandler): void {
    this.reactionHandlers.push(handler);
  }

  onRedaction(handler: RedactionHandler): void {
    this.redactionHandlers.push(handler);
  }
}
