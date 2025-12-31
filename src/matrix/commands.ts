import { type MatrixEvent } from './appservice.js';
import { type MessageContent } from './events.js';
import { matrixLogger } from '../utils/logger.js';
import { getSocialService } from '../bridge/social.js';

/**
 * Command context passed to handlers
 */
export interface CommandContext {
  event: MatrixEvent;
  args: string[];
  roomId: string;
  sender: string;
}

/**
 * Reply function for commands
 */
export type ReplyFunction = (roomId: string, message: string, html?: string) => Promise<void>;

/**
 * Command handler function
 */
export type CommandHandler = (ctx: CommandContext) => Promise<string | void>;

/**
 * Command definition
 */
interface Command {
  name: string;
  description: string;
  usage: string;
  handler: CommandHandler;
  adminOnly?: boolean;
}

/**
 * Handles bot commands from Matrix messages
 */
export class CommandProcessor {
  private prefix = '!ap';
  private commands: Map<string, Command> = new Map();
  private replyCallback: ReplyFunction | null = null;
  private adminUsers: Set<string> = new Set();

  constructor() {
    this.registerDefaultCommands();
  }

  /**
   * Register the default built-in commands
   */
  private registerDefaultCommands(): void {
    this.registerCommand({
      name: 'help',
      description: 'Show available commands',
      usage: '!ap help [command]',
      handler: async (ctx) => this.handleHelp(ctx),
    });

    this.registerCommand({
      name: 'status',
      description: 'Show bridge status and your connection status',
      usage: '!ap status',
      handler: async (_ctx) => this.handleStatus(),
    });

    this.registerCommand({
      name: 'whoami',
      description: 'Show your Matrix and ActivityPub identity',
      usage: '!ap whoami',
      handler: async (ctx) => this.handleWhoami(ctx),
    });

    this.registerCommand({
      name: 'login',
      description: 'Enable double-puppeting by providing an access token',
      usage: '!ap login <access_token>',
      handler: async (ctx) => this.handleLogin(ctx),
    });

    this.registerCommand({
      name: 'logout',
      description: 'Disable double-puppeting and remove your access token',
      usage: '!ap logout',
      handler: async (ctx) => this.handleLogout(ctx),
    });

    this.registerCommand({
      name: 'follow',
      description: 'Follow an ActivityPub user',
      usage: '!ap follow @user@instance.social',
      handler: async (ctx) => this.handleFollow(ctx),
    });

    this.registerCommand({
      name: 'unfollow',
      description: 'Unfollow an ActivityPub user',
      usage: '!ap unfollow @user@instance.social',
      handler: async (ctx) => this.handleUnfollow(ctx),
    });

    this.registerCommand({
      name: 'boost',
      description: 'Boost/reblog a message (reply to the message you want to boost)',
      usage: '!ap boost',
      handler: async (ctx) => this.handleBoost(ctx),
    });

    this.registerCommand({
      name: 'followers',
      description: 'List your followers',
      usage: '!ap followers',
      handler: async (ctx) => this.handleFollowers(ctx),
    });

    this.registerCommand({
      name: 'following',
      description: 'List who you are following',
      usage: '!ap following',
      handler: async (ctx) => this.handleFollowing(ctx),
    });

    // Admin commands
    this.registerCommand({
      name: 'admin',
      description: 'Admin commands (admin only)',
      usage: '!ap admin <subcommand>',
      handler: async (ctx) => this.handleAdmin(ctx),
      adminOnly: true,
    });
  }

  /**
   * Register a command
   */
  registerCommand(command: Command): void {
    this.commands.set(command.name.toLowerCase(), command);
  }

  /**
   * Set the reply callback
   */
  onReply(callback: ReplyFunction): void {
    this.replyCallback = callback;
  }

  /**
   * Set admin users
   */
  setAdminUsers(users: string[]): void {
    this.adminUsers = new Set(users);
  }

  /**
   * Check if a user is an admin
   */
  isAdmin(userId: string): boolean {
    return this.adminUsers.has(userId);
  }

  /**
   * Process a potential command message
   * Returns true if the message was a command
   */
  async processMessage(event: MatrixEvent, content: MessageContent): Promise<boolean> {
    const logger = matrixLogger();
    const body = content.body.trim();

    // Check if message starts with our prefix
    if (!body.toLowerCase().startsWith(this.prefix)) {
      return false;
    }

    // Parse command and arguments
    const parts = body.slice(this.prefix.length).trim().split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (commandName === undefined || commandName === '') {
      await this.reply(event.room_id, `Usage: ${this.prefix} <command>. Use \`${this.prefix} help\` for available commands.`);
      return true;
    }

    const command = this.commands.get(commandName);

    if (command === undefined) {
      await this.reply(event.room_id, `Unknown command: ${commandName}. Use \`${this.prefix} help\` for available commands.`);
      return true;
    }

    // Check admin permission
    if (command.adminOnly === true && !this.isAdmin(event.sender)) {
      await this.reply(event.room_id, 'This command requires admin privileges.');
      return true;
    }

    logger.info('Processing command', {
      command: commandName,
      sender: event.sender,
      roomId: event.room_id,
    });

    try {
      const ctx: CommandContext = {
        event,
        args,
        roomId: event.room_id,
        sender: event.sender,
      };

      const response = await command.handler(ctx);
      if (response !== undefined) {
        await this.reply(event.room_id, response);
      }
    } catch (error) {
      logger.error('Command execution failed', {
        command: commandName,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.reply(event.room_id, `Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return true;
  }

  /**
   * Send a reply to a room
   */
  private async reply(roomId: string, message: string, html?: string): Promise<void> {
    if (this.replyCallback !== null) {
      await this.replyCallback(roomId, message, html);
    } else {
      matrixLogger().warn('No reply callback registered, cannot send reply', { roomId });
    }
  }

  // Command handlers

  private handleHelp(ctx: CommandContext): string {
    const requestedCommand = ctx.args[0]?.toLowerCase();

    if (requestedCommand !== undefined) {
      const command = this.commands.get(requestedCommand);
      if (command !== undefined) {
        return `**${command.name}**\n${command.description}\n\nUsage: \`${command.usage}\``;
      }
      return `Unknown command: ${requestedCommand}`;
    }

    const lines = ['**Available Commands:**', ''];

    for (const [name, command] of this.commands) {
      if (command.adminOnly !== true || this.isAdmin(ctx.sender)) {
        lines.push(`- \`${this.prefix} ${name}\` - ${command.description}`);
      }
    }

    lines.push('', `Use \`${this.prefix} help <command>\` for detailed help.`);

    return lines.join('\n');
  }

  private handleStatus(): string {
    // TODO: Implement actual status check
    return [
      '**Bridge Status:**',
      '- Database: Connected',
      '- ActivityPub Server: Running',
      '- Matrix Appservice: Running',
    ].join('\n');
  }

  private handleWhoami(ctx: CommandContext): string {
    // TODO: Implement actual identity lookup
    const matrixId = ctx.sender;
    return [
      '**Your Identity:**',
      `- Matrix ID: ${matrixId}`,
      '- ActivityPub ID: (not linked)',
      '- Double-puppet: No',
    ].join('\n');
  }

  private handleLogin(ctx: CommandContext): string {
    const token = ctx.args[0];

    if (token === undefined) {
      return `Usage: \`${this.prefix} login <access_token>\`\n\nTo get an access token, you can use Element's "Access Token" in settings, or generate one via the Matrix API.`;
    }

    // TODO: Implement actual token storage and validation
    return 'Double-puppeting setup is not yet implemented.';
  }

  private handleLogout(_ctx: CommandContext): string {
    // TODO: Implement actual token removal
    return 'Double-puppeting logout is not yet implemented.';
  }

  private async handleFollow(ctx: CommandContext): Promise<string> {
    const handle = ctx.args[0];

    if (handle === undefined) {
      return `Usage: \`${this.prefix} follow @user@instance.social\``;
    }

    // Validate AP handle format
    if (!handle.match(/^@?[\w.-]+@[\w.-]+$/)) {
      return `Invalid handle format. Use: @username@instance.social`;
    }

    const socialService = getSocialService();
    if (socialService === null) {
      return 'Social features are not initialized.';
    }

    const result = await socialService.follow(ctx.sender, handle);
    return result.message;
  }

  private async handleUnfollow(ctx: CommandContext): Promise<string> {
    const handle = ctx.args[0];

    if (handle === undefined) {
      return `Usage: \`${this.prefix} unfollow @user@instance.social\``;
    }

    const socialService = getSocialService();
    if (socialService === null) {
      return 'Social features are not initialized.';
    }

    const result = await socialService.unfollow(ctx.sender, handle);
    return result.message;
  }

  private async handleBoost(ctx: CommandContext): Promise<string> {
    // Check if this message is a reply to another message
    const content = ctx.event.content as unknown as MessageContent;
    const replyToEventId = content['m.relates_to']?.['m.in_reply_to']?.event_id;

    if (replyToEventId === undefined) {
      return 'To boost a message, reply to that message with `!ap boost`';
    }

    const socialService = getSocialService();
    if (socialService === null) {
      return 'Social features are not initialized.';
    }

    const result = await socialService.sendBoost(ctx.sender, replyToEventId);
    return result.message;
  }

  private async handleFollowers(_ctx: CommandContext): Promise<string> {
    const socialService = getSocialService();
    if (socialService === null) {
      return 'Social features are not initialized.';
    }

    // TODO: Get user's follower list and format it
    return 'Follower listing not yet implemented. Use the bridge\'s ActivityPub endpoints to view followers.';
  }

  private async handleFollowing(_ctx: CommandContext): Promise<string> {
    const socialService = getSocialService();
    if (socialService === null) {
      return 'Social features are not initialized.';
    }

    // TODO: Get user's following list and format it
    return 'Following listing not yet implemented. Use the bridge\'s ActivityPub endpoints to view following.';
  }

  private handleAdmin(ctx: CommandContext): string {
    const subcommand = ctx.args[0]?.toLowerCase();

    switch (subcommand) {
      case 'stats':
        // TODO: Implement actual stats
        return [
          '**Bridge Statistics:**',
          '- Users: 0',
          '- Rooms: 0',
          '- Messages bridged: 0',
          '- Uptime: 0s',
        ].join('\n');

      case 'block-instance': {
        const instance = ctx.args[1];
        if (instance === undefined) {
          return `Usage: \`${this.prefix} admin block-instance <domain>\``;
        }
        // TODO: Implement actual blocking
        return `Instance blocking for ${instance} is not yet implemented.`;
      }

      case 'unblock-instance': {
        const instance = ctx.args[1];
        if (instance === undefined) {
          return `Usage: \`${this.prefix} admin unblock-instance <domain>\``;
        }
        // TODO: Implement actual unblocking
        return `Instance unblocking for ${instance} is not yet implemented.`;
      }

      case 'sync-user': {
        const mxid = ctx.args[1];
        if (mxid === undefined) {
          return `Usage: \`${this.prefix} admin sync-user <@user:domain>\``;
        }
        // TODO: Implement actual sync
        return `User sync for ${mxid} is not yet implemented.`;
      }

      default:
        return [
          '**Admin Subcommands:**',
          `- \`${this.prefix} admin stats\` - Show bridge statistics`,
          `- \`${this.prefix} admin block-instance <domain>\` - Block an instance`,
          `- \`${this.prefix} admin unblock-instance <domain>\` - Unblock an instance`,
          `- \`${this.prefix} admin sync-user <mxid>\` - Force sync a user profile`,
        ].join('\n');
    }
  }
}
