# User Guide

This guide explains how to use the Matrix-ActivityPub bridge as a Matrix user.

## Overview

The Matrix-ActivityPub bridge allows you to:

- Follow users on Mastodon, Pleroma, Misskey, and other Fediverse platforms
- Receive posts from ActivityPub users in Matrix rooms
- Send messages that appear on the Fediverse
- React to posts, boost content, and interact across platforms

## Getting Started

### Finding the Bridge Bot

The bridge bot is typically named `@apbot:yourdomain.com`. You can:

1. Start a direct message with the bot
2. Invite the bot to a room

### Basic Commands

All commands start with `!ap`. Send these in a room with the bridge bot:

| Command | Description |
|---------|-------------|
| `!ap help` | Show all available commands |
| `!ap status` | Check bridge connection status |
| `!ap whoami` | Show your bridged identity |

## Double-Puppeting (Recommended)

Double-puppeting allows your messages to appear as coming from your own Matrix identity on the Fediverse, rather than through the bridge bot.

### Enable Double-Puppeting

1. Send the login command to the bridge bot:
   ```
   !ap login
   ```

2. The bot will provide instructions to authorize the bridge. This typically involves:
   - Clicking a link to your homeserver's login page
   - Authorizing the bridge application
   - The bridge receives a token to act on your behalf

3. Confirm the login was successful:
   ```
   !ap whoami
   ```

### Disable Double-Puppeting

To revoke the bridge's access:
```
!ap logout
```

## Following ActivityPub Users

### Follow a User

To follow someone on Mastodon, Pleroma, or another Fediverse platform:

```
!ap follow @username@instance.social
```

Examples:
```
!ap follow @alice@mastodon.social
!ap follow @news@birdsite.example
!ap follow @developer@fosstodon.org
```

### View Your Follows

See who you're following:
```
!ap following
```

See your followers:
```
!ap followers
```

### Unfollow a User

```
!ap unfollow @username@instance.social
```

## Receiving Posts

When you follow someone, their posts appear in your Matrix room. Posts include:

- The author's display name and handle
- Post content (text, links, hashtags)
- Media attachments (images, videos)
- Content warnings (shown as spoilers in Matrix)

### Reply Threading

Replies maintain threading:
- ActivityPub replies appear as Matrix replies
- Your Matrix replies become ActivityPub replies

## Sending Messages

Messages you send in bridged rooms are shared on the Fediverse:

### Text Messages

Simply type your message. It will be converted to an ActivityPub Note and delivered to your followers.

### Mentions

Mention Fediverse users with the `@user@instance` format:
```
Hey @alice@mastodon.social, check this out!
```

Or mention Matrix users normally - they'll be converted appropriately.

### Hashtags

Hashtags work naturally:
```
Just discovered this amazing #opensource project! #fediverse
```

### Content Warnings / Spoilers

Use Matrix spoiler formatting for content warnings:

In Element: Select text and click the spoiler button, or use:
```html
<span data-mx-spoiler="CW: Topic">Hidden content here</span>
```

This becomes a content warning on the Fediverse.

## Media Sharing

### Images

Send images normally in Matrix. They will be:
- Uploaded to the bridge's media proxy
- Converted to accessible URLs for the Fediverse
- Include alt text if you provide it

### Videos and Audio

Videos and audio files are also bridged, though large files may take longer to process.

### Files

Other files are shared as Document attachments.

## Reactions and Boosts

### React to Posts

React to a post using Matrix's reaction feature (emoji reactions). This creates a "Like" activity on the Fediverse.

### Boost (Share) Posts

To share/boost a post to your followers:

1. Reply to the post you want to boost
2. Use the boost command:
   ```
   !ap boost
   ```

Or boost directly by replying with just:
```
!ap boost
```

## Blocking and Muting

### Block a User

Block a Fediverse user:
```
!ap block @spammer@bad.instance
```

This:
- Stops their posts from appearing
- Prevents them from following you
- Optionally notifies them of the block

### Unblock a User

```
!ap unblock @user@instance.social
```

### Report a User

Report abusive content:
```
!ap report @abuser@instance.social Reason for report
```

## Ghost Users

When ActivityPub users interact with the bridge, ghost users are created:

- Format: `@_ap_username_instance:yourdomain.com`
- Example: `@_ap_alice_mastodon_social:bridge.example.com`

These represent Fediverse users in Matrix. You can:
- View their profile
- Start DMs (creates a bridged conversation)
- See their display name and avatar

## Room Types

### Direct Messages

Start a DM with a ghost user to have a private conversation with that Fediverse user.

### Public Rooms

Messages in public bridged rooms are shared publicly on the Fediverse.

### Group Conversations

Group rooms work like group DMs, with appropriate privacy settings.

## Troubleshooting

### "User not found"

The handle might be incorrect. Verify:
- The format is `@username@instance`
- The instance domain is correct
- The user exists on that instance

### Messages not delivering

Check:
```
!ap status
```

If the bridge shows issues:
- The remote instance might be down
- There might be federation issues
- The instance might be blocked

### Media not loading

- Large files take time to process
- Some media formats may not be supported
- Check if the source instance is accessible

### Not receiving posts

- Verify you're following the user: `!ap following`
- Check if the instance is blocked
- Some posts may be followers-only or have limited visibility

## Privacy Considerations

### What's Public

- Posts in public rooms are federated publicly
- Your follows/followers may be visible
- Your profile (display name, avatar) is shared

### What's Private

- Direct messages are private
- Access tokens are encrypted
- Matrix room contents (for non-bridged rooms) are not shared

### Data Retention

- Message mappings are stored for reply threading
- Media may be cached temporarily
- Check with your bridge administrator for retention policies

## Admin Commands

If you're a bridge administrator, additional commands are available:

| Command | Description |
|---------|-------------|
| `!ap admin stats` | Show bridge statistics |
| `!ap admin block-instance <domain>` | Block an entire instance |
| `!ap admin unblock-instance <domain>` | Unblock an instance |
| `!ap admin list-blocked` | List blocked instances |

## Tips and Best Practices

1. **Enable double-puppeting** for the best experience
2. **Use content warnings** for sensitive topics
3. **Add alt text** to images for accessibility
4. **Be patient** with federation - it's not instant
5. **Report issues** to your bridge administrator

## Keyboard Shortcuts (Element)

When using Element:

- `Ctrl+Shift+E` - React with emoji
- `Ctrl+K` - Quick switcher (find rooms)
- Reply to message, then type - Creates a threaded reply

## Getting Help

- Send `!ap help` for command help
- Contact your bridge administrator
- Check the bridge status: `!ap status`
