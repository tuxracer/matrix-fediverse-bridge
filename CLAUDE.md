# Technical Requirements Document: Matrix-ActivityPub Double-Puppeting Bridge

## Development Workflow

When working on this project:

1. **Refer to TODO.md for tasks**: Always check `TODO.md` for unchecked items (`- [ ]`) to identify work that needs to be done. Work through tasks in milestone order unless directed otherwise.

2. **Mark tasks complete**: After completing a task, update `TODO.md` to mark the checkbox as done (`- [x]`).

3. **Commit after completing work**: After completing an issue or a logical set of related issues, create a git commit with a descriptive message summarizing the changes. Group related small changes into a single commit when appropriate (e.g., creating multiple related files for a feature).

4. **Keep commits atomic**: Each commit should represent a coherent unit of work that compiles and ideally passes tests. Avoid mixing unrelated changes in a single commit.

---

## Overview

This document specifies the technical requirements for implementing a bidirectional double-puppeting bridge between Matrix and ActivityPub (Fediverse) networks using TypeScript.

### Goals

- Enable seamless communication between Matrix users and ActivityPub (Mastodon, Pleroma, Misskey, etc.) users
- Support double-puppeting so Matrix users' messages appear from their own identity on both sides
- Handle media, replies, reactions, and threading across protocols
- Maintain federation compatibility with both ecosystems

### Non-Goals

- Full feature parity with native clients on either platform
- Support for ActivityPub extensions not widely adopted
- Real-time sync of profile changes (periodic sync is acceptable)

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐     ┌─────────────────┐
│                 │     │           Bridge Server              │     │                 │
│  Matrix         │     │  ┌────────────────────────────────┐  │     │  ActivityPub    │
│  Homeserver     │◄───►│  │  Matrix Appservice (Port 9000) │  │◄───►│  Servers        │
│                 │     │  └────────────────────────────────┘  │     │  (Mastodon,     │
│  (Synapse/      │     │  ┌────────────────────────────────┐  │     │   Pleroma,      │
│   Dendrite)     │     │  │  ActivityPub Server (Port 443) │  │     │   Misskey)      │
│                 │     │  └────────────────────────────────┘  │     │                 │
└─────────────────┘     │  ┌────────────────────────────────┐  │     └─────────────────┘
                        │  │  PostgreSQL Database           │  │
                        │  └────────────────────────────────┘  │
                        │  ┌────────────────────────────────┐  │
                        │  │  Redis (Queue & Cache)         │  │
                        │  └────────────────────────────────┘  │
                        └──────────────────────────────────────┘
```

### Components

| Component | Purpose |
|-----------|---------|
| Matrix Appservice | Handles Matrix CS/AS API, manages puppets, processes events |
| ActivityPub Server | Implements AP inbox/outbox, WebFinger, HTTP Signatures |
| Message Processor | Transforms messages between Matrix and ActivityPub formats |
| Puppet Manager | Creates/manages ghost users on both sides |
| Media Proxy | Handles media transfer and format conversion |
| Database | Stores user mappings, room associations, message IDs |
| Queue | Handles async message delivery and retries |

---

## Technical Requirements

### Runtime Environment

- **Runtime**: Node.js 20 LTS or later
- **Language**: TypeScript 5.3+
- **Database**: PostgreSQL 15+
- **Cache/Queue**: Redis 7+
- **Package Manager**: pnpm

### Dependencies

```json
{
  "dependencies": {
    "matrix-appservice-bridge": "^10.0.0",
    "matrix-bot-sdk": "^0.7.0",
    "@fedify/fedify": "^1.0.0",
    "express": "^4.18.0",
    "@hono/node-server": "^1.0.0",
    "pg": "^8.11.0",
    "ioredis": "^5.3.0",
    "bullmq": "^5.0.0",
    "sharp": "^0.33.0",
    "winston": "^3.11.0",
    "zod": "^3.22.0",
    "http-signature": "^1.4.0"
  }
}
```

### Matrix Appservice Requirements

1. **Registration**
   - Namespace: `@_ap_.*:yourdomain.com` for ActivityPub ghost users
   - Namespace: `#_ap_.*:yourdomain.com` for bridged rooms
   - Alias namespace: `#ap_.*:yourdomain.com`

2. **Double-Puppeting Support**
   - Store user access tokens securely (encrypted at rest)
   - Support login via `m.login.application_service`
   - Fallback to bot user when double-puppet unavailable

3. **Event Handling**
   - `m.room.message` (text, image, video, audio, file)
   - `m.room.member` (joins, leaves, invites)
   - `m.reaction` (emoji reactions)
   - `m.room.redaction` (message deletion)
   - `m.room.power_levels` (moderation)

### ActivityPub Requirements

1. **Actor Types**
   - `Person` for user representations
   - `Application` for the bridge bot

2. **Activity Types to Implement**
   - Outbound: `Create`, `Update`, `Delete`, `Like`, `Announce`, `Follow`, `Undo`, `Accept`, `Reject`
   - Inbound: Same as outbound + `Add`, `Remove`, `Block`

3. **Object Types**
   - `Note` (standard posts/messages)
   - `Article` (long-form content)
   - `Image`, `Video`, `Audio`, `Document` (media)

4. **Federation Requirements**
   - HTTP Signatures (draft-cavage-http-signatures-12)
   - WebFinger discovery
   - NodeInfo 2.1
   - Host-meta (optional but recommended)

---

## Data Models

### Database Schema

```sql
-- User mappings between Matrix and ActivityPub
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matrix_user_id TEXT UNIQUE,
    ap_actor_id TEXT UNIQUE,
    ap_inbox_url TEXT,
    ap_shared_inbox_url TEXT,
    display_name TEXT,
    avatar_url TEXT,
    is_puppet BOOLEAN DEFAULT FALSE,
    is_double_puppet BOOLEAN DEFAULT FALSE,
    access_token_encrypted BYTEA,
    private_key_pem TEXT,
    public_key_pem TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Room/conversation mappings
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matrix_room_id TEXT UNIQUE NOT NULL,
    ap_context_id TEXT,
    room_type TEXT CHECK (room_type IN ('dm', 'group', 'public')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Message ID mappings for replies and edits
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matrix_event_id TEXT UNIQUE,
    ap_object_id TEXT UNIQUE,
    room_id UUID REFERENCES rooms(id),
    sender_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Follower relationships
CREATE TABLE follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID REFERENCES users(id),
    following_id UUID REFERENCES users(id),
    ap_follow_id TEXT,
    status TEXT CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(follower_id, following_id)
);

-- Media cache
CREATE TABLE media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matrix_mxc_url TEXT,
    ap_media_url TEXT,
    mime_type TEXT,
    file_size BIGINT,
    blurhash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_matrix ON users(matrix_user_id);
CREATE INDEX idx_users_ap ON users(ap_actor_id);
CREATE INDEX idx_messages_matrix ON messages(matrix_event_id);
CREATE INDEX idx_messages_ap ON messages(ap_object_id);
```

### TypeScript Interfaces

```typescript
interface MatrixUser {
  userId: string;
  displayName?: string;
  avatarMxc?: string;
  accessToken?: string; // For double-puppeting
}

interface APActor {
  id: string;           // https://instance.social/users/username
  type: 'Person' | 'Application';
  preferredUsername: string;
  inbox: string;
  outbox: string;
  sharedInbox?: string;
  publicKey: {
    id: string;
    owner: string;
    publicKeyPem: string;
  };
}

interface BridgedMessage {
  id: string;
  matrixEventId?: string;
  apObjectId?: string;
  content: {
    text: string;
    html?: string;
    media?: MediaAttachment[];
  };
  replyTo?: string;
  sender: string;
  timestamp: Date;
}

interface MediaAttachment {
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  blurhash?: string;
  description?: string;
}
```

---

## API Specifications

### Matrix Appservice Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/_matrix/app/v1/transactions/:txnId` | PUT | Receive events from homeserver |
| `/_matrix/app/v1/users/:userId` | GET | Query ghost user existence |
| `/_matrix/app/v1/rooms/:roomAlias` | GET | Query room alias existence |

### ActivityPub Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/.well-known/webfinger` | GET | User discovery |
| `/.well-known/nodeinfo` | GET | NodeInfo discovery |
| `/.well-known/host-meta` | GET | Host metadata |
| `/nodeinfo/2.1` | GET | NodeInfo document |
| `/users/:username` | GET | Actor profile |
| `/users/:username/inbox` | POST | Receive activities |
| `/users/:username/outbox` | GET | Public activities |
| `/users/:username/followers` | GET | Followers collection |
| `/users/:username/following` | GET | Following collection |
| `/inbox` | POST | Shared inbox |
| `/activities/:id` | GET | Activity lookup |
| `/objects/:id` | GET | Object lookup |
| `/media/:id` | GET | Media proxy |

### WebFinger Response Format

```json
{
  "subject": "acct:user@bridge.example.com",
  "aliases": [
    "https://bridge.example.com/users/user"
  ],
  "links": [
    {
      "rel": "self",
      "type": "application/activity+json",
      "href": "https://bridge.example.com/users/user"
    },
    {
      "rel": "http://webfinger.net/rel/profile-page",
      "type": "text/html",
      "href": "https://bridge.example.com/@user"
    }
  ]
}
```

---

## Message Transformation

### Matrix to ActivityPub

```typescript
function matrixToAP(event: MatrixEvent): APNote {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://bridge.example.com/objects/${event.event_id}`,
    type: 'Note',
    attributedTo: matrixUserToAPActor(event.sender),
    content: convertMatrixHtmlToAP(event.content.formatted_body || event.content.body),
    published: new Date(event.origin_server_ts).toISOString(),
    to: determineAudience(event),
    inReplyTo: event.content['m.relates_to']?.['m.in_reply_to']?.event_id
      ? lookupAPObjectId(event.content['m.relates_to']['m.in_reply_to'].event_id)
      : undefined,
    attachment: event.content.url ? [convertMedia(event.content)] : undefined,
  };
}
```

### ActivityPub to Matrix

```typescript
function apToMatrix(note: APNote): MatrixMessageContent {
  return {
    msgtype: 'm.text',
    body: stripHtml(note.content),
    format: 'org.matrix.custom.html',
    formatted_body: sanitizeHtml(note.content),
    'm.relates_to': note.inReplyTo ? {
      'm.in_reply_to': {
        event_id: lookupMatrixEventId(note.inReplyTo),
      },
    } : undefined,
  };
}
```

### Content Transformations

| Matrix | ActivityPub | Notes |
|--------|-------------|-------|
| `@user:server` | `@user@server` | Mention format conversion |
| `#room:server` | `#hashtag` | Hashtag extraction where applicable |
| MXC URLs | HTTPS URLs | Media URL conversion via proxy |
| Custom emoji `:name:` | Custom emoji shortcode | Preserve or convert to unicode |
| Spoilers `<span data-mx-spoiler>` | CW/Summary | Content warning conversion |
| Reply fallback | `inReplyTo` | Threading preservation |

---

## Security Requirements

### Cryptographic Requirements

1. **HTTP Signatures**
   - Algorithm: `rsa-sha256` (required) or `hs2019` (recommended)
   - Key size: RSA 2048-bit minimum, 4096-bit recommended
   - Headers to sign: `(request-target)`, `host`, `date`, `digest`

2. **Token Storage**
   - Encrypt Matrix access tokens using AES-256-GCM
   - Store encryption key in environment variable or secrets manager
   - Never log access tokens

3. **Input Validation**
   - Validate all ActivityPub JSON-LD with strict schema
   - Sanitize HTML content (allowlist approach)
   - Validate media MIME types against actual content
   - Rate limit incoming requests per remote server

### Network Security

1. **HTTPS Only**
   - TLS 1.3 preferred, TLS 1.2 minimum
   - Valid certificates required for federation

2. **Request Validation**
   - Verify HTTP signatures on all incoming AP requests
   - Validate `Date` header (reject if >30 seconds drift)
   - Check `Digest` header matches body

3. **Anti-Abuse**
   - Implement instance-level blocking
   - Rate limiting per remote server (100 req/min default)
   - Queue depth limits to prevent DoS

---

## Configuration

### Environment Variables

```bash
# Matrix Configuration
MATRIX_HOMESERVER_URL=https://matrix.example.com
MATRIX_DOMAIN=example.com
MATRIX_APPSERVICE_TOKEN=<as_token>
MATRIX_HOMESERVER_TOKEN=<hs_token>
MATRIX_APPSERVICE_PORT=9000

# ActivityPub Configuration
AP_DOMAIN=bridge.example.com
AP_PORT=443
AP_PRIVATE_KEY_PATH=/etc/bridge/private.pem

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/bridge

# Redis
REDIS_URL=redis://localhost:6379

# Security
ENCRYPTION_KEY=<32-byte-hex-key>
BLOCKED_INSTANCES=bad.instance,spam.server

# Logging
LOG_LEVEL=info
```

### Appservice Registration (registration.yaml)

```yaml
id: activitypub-bridge
url: http://localhost:9000
as_token: <generate-secure-token>
hs_token: <generate-secure-token>
sender_localpart: apbot
namespaces:
  users:
    - exclusive: true
      regex: '@_ap_.*:example\.com'
  rooms:
    - exclusive: true
      regex: '#_ap_.*:example\.com'
  aliases:
    - exclusive: true
      regex: '#ap_.*:example\.com'
rate_limited: false
```

---

## Milestones

### Milestone 1: Project Foundation
**Objective**: Set up project structure, tooling, and core infrastructure

#### Steps:
1. Initialize TypeScript project with pnpm
   - Configure `tsconfig.json` with strict mode
   - Set up ESLint and Prettier
   - Configure Jest for testing
2. Set up Docker Compose for local development
   - PostgreSQL container
   - Redis container
   - Test Matrix homeserver (Synapse)
3. Implement database layer
   - Set up connection pooling with `pg`
   - Create migration system
   - Implement all schema migrations
4. Implement configuration management
   - Environment variable parsing with Zod validation
   - Configuration type definitions
5. Set up logging infrastructure
   - Winston logger configuration
   - Request ID tracking
   - Structured JSON logging

**Deliverables**:
- Working development environment
- Database migrations
- Configuration system
- Logging infrastructure

---

### Milestone 2: Matrix Appservice Core
**Objective**: Implement Matrix appservice that can receive and process events

#### Steps:
1. Implement appservice HTTP server
   - Transaction endpoint (`PUT /_matrix/app/v1/transactions/:txnId`)
   - User query endpoint
   - Room alias query endpoint
2. Set up matrix-appservice-bridge integration
   - Intent API for acting as users
   - Room store and user store
3. Implement ghost user management
   - Create ghost users for AP accounts (`@_ap_user_instance:domain`)
   - Profile sync (display name, avatar)
4. Implement event handlers
   - `m.room.message` handler
   - `m.room.member` handler
   - `m.reaction` handler
   - `m.room.redaction` handler
5. Implement double-puppeting
   - Token storage and encryption
   - Login flow via `!ap login`
   - Automatic token refresh

**Deliverables**:
- Working appservice registration
- Ghost user creation
- Event processing pipeline
- Double-puppeting support

---

### Milestone 3: ActivityPub Server Core
**Objective**: Implement ActivityPub server that can federate with Mastodon/Pleroma

#### Steps:
1. Implement WebFinger endpoint
   - `/.well-known/webfinger` with proper JRD response
   - Account lookup for bridged Matrix users
2. Implement NodeInfo
   - `/.well-known/nodeinfo`
   - `/nodeinfo/2.1` with bridge statistics
3. Implement Actor endpoints
   - GET `/users/:username` (Actor JSON-LD)
   - Actor key pair generation and storage
4. Implement HTTP Signatures
   - Request signing for outbound requests
   - Signature verification for inbound requests
5. Implement Inbox
   - POST `/users/:username/inbox`
   - POST `/inbox` (shared inbox)
   - Activity validation and processing
6. Implement Outbox
   - GET `/users/:username/outbox` (public activities)
   - Activity creation and delivery

**Deliverables**:
- Discoverable actors via WebFinger
- Valid HTTP signature implementation
- Working inbox/outbox

---

### Milestone 4: Message Bridging
**Objective**: Enable bidirectional message flow between Matrix and ActivityPub

#### Steps:
1. Implement Matrix-to-AP message transformation
   - Plain text conversion
   - HTML sanitization and conversion
   - Mention translation (`@user:server` to `@user@server`)
2. Implement AP-to-Matrix message transformation
   - HTML to Matrix HTML subset
   - Mention translation
   - Content warning to spoiler conversion
3. Implement message routing
   - DM detection and routing
   - Room-to-conversation mapping
4. Implement reply threading
   - `m.relates_to` to `inReplyTo` mapping
   - Event ID to Object ID lookup table
5. Implement message queue
   - BullMQ job processing
   - Retry logic with exponential backoff
   - Dead letter queue for failed deliveries
6. Implement delivery
   - Fan-out to follower inboxes
   - Shared inbox optimization
   - Delivery status tracking

**Deliverables**:
- Bidirectional text messages
- Reply threading
- Reliable delivery with retries

---

### Milestone 5: Media Handling
**Objective**: Support media attachments across the bridge

#### Steps:
1. Implement media proxy
   - MXC to HTTPS URL conversion
   - HTTPS to MXC upload
   - Caching layer
2. Implement image processing
   - Blurhash generation
   - Thumbnail generation
   - Format conversion (WebP support)
3. Implement media types
   - Images (`m.image` <-> `Image`)
   - Videos (`m.video` <-> `Video`)
   - Audio (`m.audio` <-> `Audio`)
   - Files (`m.file` <-> `Document`)
4. Implement media metadata
   - Dimensions
   - Duration (audio/video)
   - Alt text/description bridging

**Deliverables**:
- Image bridging with thumbnails
- Video/audio bridging
- File attachment bridging

---

### Milestone 6: Social Features
**Objective**: Implement follows, reactions, and boosts

#### Steps:
1. Implement Follow/Unfollow
   - Matrix command: `!ap follow @user@instance`
   - `Follow` activity generation
   - `Accept`/`Reject` handling
   - Follower list management
2. Implement reactions
   - `m.reaction` to `Like` activity
   - `Like` activity to `m.reaction`
   - Emoji mapping
3. Implement boosts/announces
   - `Announce` activity to Matrix (as quote or forward)
   - Matrix boost command: `!ap boost`
4. Implement Undo activities
   - Unlike (undo reaction)
   - Unfollow
   - Unboost

**Deliverables**:
- Working follow/unfollow
- Reaction bridging
- Boost support

---

### Milestone 7: Moderation & Admin
**Objective**: Implement moderation tools and admin interface

#### Steps:
1. Implement message deletion
   - `m.room.redaction` to `Delete` activity
   - `Delete` activity to redaction
2. Implement blocking
   - User-level blocks
   - Instance-level blocks (admin)
   - `Block` activity support
3. Implement reporting
   - `Flag` activity handling
   - Report forwarding to Matrix admin room
4. Implement admin commands
   - `!ap admin block-instance <domain>`
   - `!ap admin stats`
   - `!ap admin sync-user <mxid>`
5. Implement admin dashboard (optional)
   - Web UI for bridge statistics
   - User management
   - Federation health monitoring

**Deliverables**:
- Message deletion
- User and instance blocking
- Admin command suite

---

### Milestone 8: Polish & Production Readiness
**Objective**: Prepare for production deployment

#### Steps:
1. Implement comprehensive error handling
   - Graceful degradation
   - User-friendly error messages
   - Error reporting to admin room
2. Implement monitoring
   - Prometheus metrics endpoint
   - Key metrics: message volume, latency, error rates
   - Health check endpoint
3. Performance optimization
   - Database query optimization
   - Connection pooling tuning
   - Caching strategy refinement
4. Documentation
   - Deployment guide
   - Configuration reference
   - User guide for Matrix users
5. Testing
   - Unit tests (>80% coverage)
   - Integration tests with test homeserver
   - Federation tests with Mastodon/Pleroma
6. Security audit
   - Dependency audit
   - Input validation review
   - HTTP signature implementation review

**Deliverables**:
- Production-ready deployment
- Monitoring and alerting
- Complete documentation
- Test suite

---

## Directory Structure

```
matrix-fediverse-bridge/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config/
│   │   └── index.ts             # Configuration management
│   ├── matrix/
│   │   ├── appservice.ts        # Appservice setup
│   │   ├── events.ts            # Event handlers
│   │   ├── puppet.ts            # Puppet management
│   │   └── commands.ts          # Bot commands
│   ├── activitypub/
│   │   ├── server.ts            # HTTP server
│   │   ├── webfinger.ts         # WebFinger endpoint
│   │   ├── actor.ts             # Actor management
│   │   ├── inbox.ts             # Inbox processing
│   │   ├── outbox.ts            # Outbox and delivery
│   │   └── signatures.ts        # HTTP signatures
│   ├── bridge/
│   │   ├── transformer.ts       # Message transformation
│   │   ├── router.ts            # Message routing
│   │   └── media.ts             # Media handling
│   ├── db/
│   │   ├── index.ts             # Database client
│   │   ├── migrations/          # SQL migrations
│   │   └── repositories/        # Data access layer
│   ├── queue/
│   │   ├── index.ts             # Queue setup
│   │   └── workers/             # Job processors
│   └── utils/
│       ├── logger.ts            # Logging
│       ├── crypto.ts            # Encryption utilities
│       └── validation.ts        # Input validation
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── docs/
│   ├── deployment.md
│   ├── configuration.md
│   └── user-guide.md
├── package.json
├── tsconfig.json
├── CLAUDE.md                    # This document
└── README.md
```

---

## Testing Strategy

### Unit Tests
- Message transformation functions
- HTTP signature generation/verification
- Database repository methods
- Configuration validation

### Integration Tests
- Matrix appservice event processing
- ActivityPub inbox processing
- End-to-end message flow (mocked external services)

### Federation Tests
- WebFinger discovery
- Actor fetch
- Activity delivery to real Mastodon instance (test environment)

### Test Matrix

| Component | Unit | Integration | E2E |
|-----------|------|-------------|-----|
| Config | Yes | - | - |
| Matrix Events | Yes | Yes | Yes |
| AP Inbox | Yes | Yes | Yes |
| Signatures | Yes | Yes | - |
| Transformer | Yes | - | - |
| Media Proxy | Yes | Yes | Yes |
| Database | Yes | Yes | - |

---

## Success Criteria

1. **Functional**: Bidirectional text messages with <5 second latency
2. **Reliable**: <0.1% message loss rate
3. **Scalable**: Support 10,000+ bridged users
4. **Compatible**: Federation with Mastodon 4.x, Pleroma, Misskey
5. **Secure**: Pass security audit with no critical findings

---

## References

- [Matrix Application Service API](https://spec.matrix.org/latest/application-service-api/)
- [ActivityPub Specification](https://www.w3.org/TR/activitypub/)
- [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)
- [HTTP Signatures](https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12)
- [WebFinger](https://datatracker.ietf.org/doc/html/rfc7033)
- [matrix-appservice-bridge](https://github.com/matrix-org/matrix-appservice-bridge)
- [Fedify](https://fedify.dev/)
