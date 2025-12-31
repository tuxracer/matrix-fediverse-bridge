# Matrix-ActivityPub Bridge - Development TODO

## Milestone 1: Project Foundation

### Project Setup
- [x] Initialize pnpm project with `pnpm init`
- [x] Install TypeScript and configure `tsconfig.json` with strict mode
- [x] Set up ESLint with TypeScript parser and recommended rules
- [x] Set up Prettier with consistent formatting rules
- [x] Configure Jest for TypeScript testing
- [x] Create `.gitignore` for Node.js/TypeScript projects
- [x] Set up `nodemon` or `ts-node-dev` for development hot reloading

### Directory Structure
- [x] Create `src/` directory structure as defined in TRD
- [x] Create `src/config/` directory
- [x] Create `src/matrix/` directory
- [x] Create `src/activitypub/` directory
- [x] Create `src/bridge/` directory
- [x] Create `src/db/` directory with `migrations/` and `repositories/` subdirectories
- [x] Create `src/queue/` directory with `workers/` subdirectory
- [x] Create `src/utils/` directory
- [x] Create `tests/unit/`, `tests/integration/`, and `tests/fixtures/` directories
- [x] Create `docker/` directory

### Dependencies
- [x] Install `matrix-appservice-bridge` and `matrix-bot-sdk`
- [x] Install `@fedify/fedify` for ActivityPub support
- [x] Install `express` and `@hono/node-server` for HTTP servers
- [x] Install `pg` for PostgreSQL connectivity
- [x] Install `ioredis` and `bullmq` for Redis and job queues
- [x] Install `sharp` for image processing
- [x] Install `winston` for logging
- [x] Install `zod` for schema validation
- [x] Install `http-signature` for HTTP signature support
- [x] Install development dependencies (TypeScript, Jest, ESLint, etc.)

### Docker Development Environment
- [x] Create `docker/docker-compose.yml` with PostgreSQL service
- [x] Add Redis service to docker-compose
- [x] Add Synapse (Matrix homeserver) service for local testing
- [x] Create `docker/Dockerfile` for the bridge application
- [x] Add volume mounts for persistent data
- [x] Configure network settings for inter-container communication

### Configuration System
- [x] Create `src/config/index.ts` with Zod schema for environment variables
- [x] Define `MatrixConfig` interface and validation
- [x] Define `ActivityPubConfig` interface and validation
- [x] Define `DatabaseConfig` interface and validation
- [x] Define `RedisConfig` interface and validation
- [x] Define `SecurityConfig` interface and validation
- [x] Create `.env.example` file with all required variables
- [x] Implement config loading with sensible defaults

### Logging Infrastructure
- [x] Create `src/utils/logger.ts` with Winston configuration
- [x] Configure JSON structured logging format
- [x] Implement log levels based on environment
- [x] Add request ID tracking middleware
- [x] Configure log rotation for production
- [x] Create logging helper functions for common patterns

### Database Layer
- [x] Create `src/db/index.ts` with pg Pool configuration
- [x] Implement connection pooling settings
- [x] Create migration runner utility
- [x] Create `src/db/migrations/001_create_users_table.sql`
- [x] Create `src/db/migrations/002_create_rooms_table.sql`
- [x] Create `src/db/migrations/003_create_messages_table.sql`
- [x] Create `src/db/migrations/004_create_follows_table.sql`
- [x] Create `src/db/migrations/005_create_media_table.sql`
- [x] Create `src/db/migrations/006_create_indexes.sql`
- [x] Implement migration up/down functionality
- [ ] Create database seed script for development

### Entry Point
- [x] Create `src/index.ts` main entry point
- [x] Implement graceful startup sequence
- [x] Implement graceful shutdown handlers (SIGINT, SIGTERM)
- [x] Add health check initialization

---

## Milestone 2: Matrix Appservice Core

### Appservice HTTP Server
- [x] Create `src/matrix/appservice.ts` base server setup
- [x] Implement `PUT /_matrix/app/v1/transactions/:txnId` endpoint
- [x] Implement transaction deduplication logic
- [x] Implement `GET /_matrix/app/v1/users/:userId` query endpoint
- [x] Implement `GET /_matrix/app/v1/rooms/:roomAlias` query endpoint
- [x] Add request logging middleware
- [x] Add error handling middleware

### Appservice Registration
- [x] Create `registration.yaml` template
- [x] Generate secure `as_token` and `hs_token`
- [x] Configure user namespace regex `@_ap_.*:domain`
- [x] Configure room namespace regex `#_ap_.*:domain`
- [x] Configure alias namespace regex `#ap_.*:domain`
- [x] Document registration with homeserver

### matrix-appservice-bridge Integration
- [ ] Initialize Bridge instance in appservice
- [ ] Configure Intent API for acting as users
- [ ] Set up RoomBridgeStore for room mappings
- [ ] Set up UserBridgeStore for user mappings
- [ ] Implement bridge startup routine
- [ ] Handle bridge reconnection logic

### Ghost User Management
- [x] Create `src/matrix/puppet.ts` for puppet management
- [x] Implement ghost user ID generation (`@_ap_user_instance:domain`)
- [x] Implement `createGhostUser()` function
- [x] Implement `getOrCreateGhostUser()` function
- [x] Implement profile sync for display name
- [x] Implement profile sync for avatar (MXC upload)
- [x] Add ghost user caching layer

### User Repository
- [ ] Create `src/db/repositories/users.ts`
- [ ] Implement `findByMatrixId()` method
- [ ] Implement `findByAPActorId()` method
- [ ] Implement `create()` method
- [ ] Implement `update()` method
- [ ] Implement `setAccessToken()` with encryption
- [ ] Implement `getAccessToken()` with decryption

### Event Handlers
- [x] Create `src/matrix/events.ts` event handler module
- [x] Implement event type dispatcher
- [x] Implement `m.room.message` handler for text messages
- [x] Implement `m.room.message` handler for `m.image` msgtype
- [x] Implement `m.room.message` handler for `m.video` msgtype
- [x] Implement `m.room.message` handler for `m.audio` msgtype
- [x] Implement `m.room.message` handler for `m.file` msgtype
- [x] Implement `m.room.member` handler for joins
- [x] Implement `m.room.member` handler for leaves
- [x] Implement `m.room.member` handler for invites
- [x] Implement `m.reaction` handler
- [x] Implement `m.room.redaction` handler
- [x] Add event filtering for bridge-originated events (prevent loops)

### Double-Puppeting
- [ ] Implement access token encryption utility in `src/utils/crypto.ts`
- [ ] Implement access token decryption utility
- [x] Create `!ap login` command handler
- [ ] Implement `m.login.application_service` login flow
- [ ] Store encrypted access tokens in database
- [ ] Implement token validation on startup
- [ ] Implement automatic token refresh mechanism
- [ ] Implement fallback to bot user when double-puppet unavailable

### Bot Commands
- [x] Create `src/matrix/commands.ts` command handler
- [x] Implement command parser for `!ap` prefix
- [x] Implement `!ap help` command
- [x] Implement `!ap login` command
- [x] Implement `!ap logout` command
- [x] Implement `!ap status` command
- [x] Implement `!ap whoami` command

---

## Milestone 3: ActivityPub Server Core

### HTTP Server Setup
- [x] Create `src/activitypub/server.ts` with Express/Hono
- [x] Configure JSON-LD content type handling
- [x] Add `Accept` header parsing for content negotiation
- [x] Implement request logging
- [x] Add rate limiting middleware
- [x] Configure CORS if needed

### WebFinger Endpoint
- [x] Create `src/activitypub/webfinger.ts`
- [x] Implement `GET /.well-known/webfinger` endpoint
- [x] Parse `resource` query parameter (acct: format)
- [x] Look up Matrix user by AP username
- [x] Generate JRD response with correct links
- [x] Add `self` link with `application/activity+json` type
- [x] Add profile page link
- [x] Handle user not found (404)
- [x] Add caching headers

### NodeInfo
- [x] Implement `GET /.well-known/nodeinfo` discovery endpoint
- [x] Create `/nodeinfo/2.1` endpoint
- [x] Include software name and version
- [x] Include protocol support (activitypub)
- [x] Include usage statistics (user count, post count)
- [x] Include open registrations status (false for bridge)

### Host-Meta (Optional)
- [x] Implement `GET /.well-known/host-meta` endpoint
- [x] Return XML with WebFinger template

### Actor Management
- [x] Create `src/activitypub/actor.ts`
- [x] Implement `GET /users/:username` endpoint
- [x] Generate Actor JSON-LD structure
- [x] Include `id`, `type`, `preferredUsername`
- [x] Include `inbox`, `outbox`, `followers`, `following` URLs
- [x] Include `publicKey` object with PEM
- [x] Include `icon` for avatar
- [x] Include `name` for display name
- [x] Add content negotiation (JSON-LD vs HTML)

### Key Pair Management
- [x] Implement RSA key pair generation (4096-bit)
- [ ] Store private key PEM in database
- [ ] Store public key PEM in database
- [ ] Implement key retrieval by actor
- [x] Create keys on actor first access

### HTTP Signatures
- [x] Create `src/activitypub/signatures.ts`
- [x] Implement `signRequest()` function for outbound requests
- [x] Sign `(request-target)`, `host`, `date`, `digest` headers
- [x] Implement `verifySignature()` for inbound requests
- [x] Fetch remote actor public keys
- [x] Cache public keys with TTL
- [x] Handle key rotation (refetch on verification failure)
- [x] Implement `Digest` header generation
- [x] Implement `Digest` header verification

### Inbox Processing
- [x] Create `src/activitypub/inbox.ts`
- [x] Implement `POST /users/:username/inbox` endpoint
- [x] Implement `POST /inbox` shared inbox endpoint
- [x] Verify HTTP signature on all requests
- [x] Validate `Date` header (reject >30s drift)
- [x] Validate `Digest` header matches body
- [x] Parse and validate Activity JSON-LD
- [x] Route activities by type to handlers
- [x] Implement idempotency (deduplicate by activity ID)

### Activity Handlers (Inbound)
- [x] Implement `Create` activity handler
- [x] Implement `Update` activity handler
- [x] Implement `Delete` activity handler
- [x] Implement `Like` activity handler
- [x] Implement `Announce` activity handler
- [x] Implement `Follow` activity handler
- [x] Implement `Accept` activity handler (follow acceptance)
- [x] Implement `Reject` activity handler
- [x] Implement `Undo` activity handler
- [x] Implement `Block` activity handler
- [x] Implement `Add` activity handler
- [x] Implement `Remove` activity handler

### Outbox
- [ ] Create `src/activitypub/outbox.ts`
- [x] Implement `GET /users/:username/outbox` endpoint
- [ ] Return OrderedCollection with public activities
- [ ] Implement pagination with `next`/`prev` links
- [ ] Filter to only public activities

### Collections
- [x] Implement `GET /users/:username/followers` endpoint
- [x] Implement `GET /users/:username/following` endpoint
- [x] Return OrderedCollection format
- [ ] Implement pagination

### Object/Activity Lookup
- [ ] Implement `GET /activities/:id` endpoint
- [ ] Implement `GET /objects/:id` endpoint
- [ ] Return 404 for non-existent objects
- [ ] Add authorization checks (public vs private)

---

## Milestone 4: Message Bridging

### Message Transformer
- [x] Create `src/bridge/transformer.ts`
- [x] Implement `matrixToAP()` main transformation function
- [x] Implement `apToMatrix()` main transformation function

### Matrix to ActivityPub Transformation
- [x] Convert plain text body to Note content
- [x] Convert formatted HTML body to Note content
- [x] Sanitize HTML (allowlist safe tags)
- [x] Transform Matrix mentions `@user:server` to `@user@server`
- [x] Transform room mentions to hashtags where applicable
- [x] Handle spoiler tags (`data-mx-spoiler`) to Content Warnings
- [x] Convert MXC URLs to proxy HTTPS URLs
- [x] Set `published` timestamp from event
- [x] Set `attributedTo` to actor URL
- [x] Determine audience (`to`, `cc`) based on room type
- [ ] Handle custom emoji shortcodes

### ActivityPub to Matrix Transformation
- [x] Convert Note `content` HTML to Matrix HTML subset
- [x] Sanitize incoming HTML
- [x] Strip disallowed tags/attributes
- [x] Transform `@user@server` mentions to `@user:server`
- [x] Transform hashtags (preserve or convert)
- [x] Handle Content Warnings to spoiler format
- [x] Set `msgtype` appropriately
- [x] Set `format` to `org.matrix.custom.html` when HTML present
- [ ] Convert remote media URLs to MXC (via upload)

### Reply Threading
- [x] Extract reply-to from Matrix `m.relates_to.m.in_reply_to`
- [x] Look up AP object ID for Matrix event ID
- [x] Set `inReplyTo` field on AP Note
- [x] Extract `inReplyTo` from AP Note
- [x] Look up Matrix event ID for AP object ID
- [x] Set `m.relates_to.m.in_reply_to` on Matrix message
- [x] Handle missing reply targets gracefully

### Message ID Mapping
- [x] Create `src/db/repositories/messages.ts`
- [x] Implement `create()` to store mapping
- [x] Implement `findByMatrixEventId()` lookup
- [x] Implement `findByAPObjectId()` lookup
- [x] Generate deterministic AP object IDs from Matrix events
- [x] Store bidirectional mappings on message bridge

### Room/Conversation Mapping
- [x] Create `src/db/repositories/rooms.ts`
- [x] Implement room type detection (DM, group, public)
- [x] Map Matrix room ID to AP context ID
- [x] Create room mapping on first bridged message
- [x] Implement `findByMatrixRoomId()` lookup

### Message Router
- [x] Create `src/bridge/router.ts`
- [x] Detect if message should be bridged
- [x] Check if sender has AP followers
- [x] Determine target inboxes for AP delivery
- [x] Handle DM routing (direct to recipient inbox)
- [x] Handle public post routing (fan-out to followers)

### Message Queue
- [x] Create `src/queue/index.ts` BullMQ setup
- [x] Create Redis connection for queue
- [x] Define `matrix-to-ap` queue
- [x] Define `ap-to-matrix` queue
- [x] Define `ap-delivery` queue
- [x] Configure queue options (attempts, backoff)

### Queue Workers
- [x] Create `src/queue/workers/matrixToAP.ts` worker
- [x] Process Matrix events, transform, enqueue delivery
- [x] Create `src/queue/workers/apToMatrix.ts` worker
- [x] Process AP activities, transform, send to Matrix
- [x] Create `src/queue/workers/apDelivery.ts` worker
- [x] Deliver activities to remote inboxes

### Delivery System
- [x] Implement inbox delivery with HTTP signatures
- [x] Implement shared inbox optimization
- [x] Handle delivery failures (retry with backoff)
- [x] Implement exponential backoff (1s, 2s, 4s, 8s...)
- [x] Configure max retry attempts
- [x] Implement dead letter queue for permanent failures
- [x] Track delivery status per inbox
- [x] Log failed deliveries for debugging

### Fan-out Delivery
- [x] Fetch follower list for sender
- [x] Deduplicate by shared inbox
- [x] Create delivery jobs for each unique inbox
- [ ] Batch deliveries where possible

---

## Milestone 5: Media Handling

### Media Proxy
- [x] Create `src/bridge/media.ts`
- [x] Implement `GET /media/:id` proxy endpoint
- [x] Serve cached media from local storage/S3
- [x] Implement on-demand fetch for uncached media

### MXC to HTTPS Conversion
- [x] Parse MXC URLs (`mxc://server/mediaId`)
- [x] Generate proxy HTTPS URL
- [x] Create media database record
- [x] Return proxy URL for AP posts

### HTTPS to MXC Conversion
- [x] Fetch remote media from AP URL
- [x] Validate content type matches claimed type
- [x] Upload to Matrix homeserver via media API
- [x] Store MXC URL in database
- [x] Return MXC URL for Matrix messages

### Media Repository
- [x] Create `src/db/repositories/media.ts`
- [x] Implement `create()` method
- [x] Implement `findByMxcUrl()` method
- [x] Implement `findByAPUrl()` method
- [x] Implement `findById()` method

### Image Processing
- [x] Install and configure Sharp
- [x] Implement thumbnail generation
- [x] Configure thumbnail dimensions
- [x] Implement blurhash generation
- [x] Implement format detection
- [x] Implement WebP conversion (optional)
- [x] Implement image dimension extraction

### Media Type Handlers
- [x] Implement image bridging (`m.image` <-> `Image`)
- [x] Extract/preserve image dimensions
- [x] Extract/preserve alt text
- [x] Implement video bridging (`m.video` <-> `Video`)
- [x] Implement audio bridging (`m.audio` <-> `Audio`)
- [x] Implement file bridging (`m.file` <-> `Document`)

### Media Metadata
- [x] Preserve image dimensions across bridge
- [x] Preserve video/audio duration
- [x] Bridge alt text/description
- [x] Generate blurhash for images without one
- [x] Include blurhash in AP attachments

### Media Caching
- [x] Implement LRU cache for frequently accessed media
- [x] Configure cache TTL
- [x] Implement cache eviction
- [x] Add cache headers to proxy responses

---

## Milestone 6: Social Features

### Follow/Unfollow
- [x] Create `src/db/repositories/follows.ts`
- [x] Implement `create()` for new follow
- [x] Implement `findByFollowerAndFollowing()`
- [x] Implement `updateStatus()` for accept/reject
- [x] Implement `delete()` for unfollow
- [x] Implement `findFollowers()` for actor
- [x] Implement `findFollowing()` for actor

### Follow Commands
- [x] Implement `!ap follow @user@instance` command
- [x] Parse AP handle from command
- [x] Resolve handle via WebFinger
- [x] Fetch remote actor
- [x] Create Follow activity
- [x] Sign and deliver to remote inbox
- [x] Store pending follow in database

### Follow Activity Handling
- [x] Handle inbound `Follow` activity
- [x] Auto-accept follows (configurable)
- [x] Generate `Accept` activity
- [x] Deliver Accept to follower inbox
- [x] Update follow status in database

### Unfollow
- [x] Implement `!ap unfollow @user@instance` command
- [x] Create `Undo` activity wrapping original Follow
- [x] Deliver to remote inbox
- [x] Remove follow from database

### Reactions
- [x] Handle `m.reaction` Matrix events
- [x] Extract emoji from reaction
- [x] Look up AP object ID for reacted message
- [x] Create `Like` activity
- [x] Deliver to post author inbox

### Inbound Reactions
- [x] Handle inbound `Like` activity
- [x] Look up Matrix event ID for liked object
- [x] Create `m.reaction` event
- [x] Send via puppet or bot

### Reaction Undo
- [x] Handle `m.redaction` of reactions
- [x] Create `Undo` activity for Like
- [x] Deliver undo to original recipient
- [x] Handle inbound `Undo` of `Like`
- [ ] Redact corresponding Matrix reaction

### Boosts/Announces
- [x] Handle inbound `Announce` activity
- [x] Fetch announced object if not cached
- [x] Create Matrix message representing boost
- [x] Include boost attribution
- [x] Implement `!ap boost` command
- [x] Create `Announce` activity
- [x] Deliver to followers

### Boost Undo
- [ ] Implement `!ap unboost` command
- [x] Create `Undo` activity for Announce
- [x] Handle inbound `Undo` of `Announce`

---

## Milestone 7: Moderation & Admin

### Message Deletion (Matrix to AP)
- [ ] Handle `m.room.redaction` events
- [ ] Look up AP object ID for redacted event
- [ ] Create `Delete` activity
- [ ] Deliver to all original recipients
- [ ] Remove local object cache

### Message Deletion (AP to Matrix)
- [ ] Handle inbound `Delete` activity
- [ ] Look up Matrix event ID for deleted object
- [ ] Redact Matrix event via puppet or bot
- [ ] Handle tombstone for deleted actors

### User Blocking
- [ ] Implement `!ap block @user@instance` command
- [ ] Create `Block` activity
- [ ] Deliver to blocked user
- [ ] Store block in database
- [ ] Filter incoming activities from blocked users
- [ ] Handle inbound `Block` activity

### Instance Blocking
- [ ] Implement `!ap admin block-instance <domain>` command
- [ ] Store blocked instances in database/config
- [ ] Reject all activities from blocked instances
- [ ] Skip delivery to blocked instances
- [ ] Log blocked attempts

### Reporting
- [ ] Handle inbound `Flag` activity
- [ ] Forward report to admin Matrix room
- [ ] Include report details (actor, object, content)
- [ ] Implement `!ap report @user@instance [reason]` command
- [ ] Create `Flag` activity for outbound reports

### Admin Commands
- [ ] Create admin room detection/setup
- [ ] Implement `!ap admin stats` command
- [ ] Show user counts, message counts, federation stats
- [ ] Implement `!ap admin sync-user <mxid>` command
- [ ] Force profile sync for user
- [ ] Implement `!ap admin list-blocked` command
- [ ] Implement `!ap admin unblock-instance <domain>` command
- [ ] Implement `!ap admin purge-user <handle>` command

### Admin Permission Checks
- [ ] Define admin user list in config
- [ ] Verify admin permissions before admin commands
- [ ] Log admin actions

### Admin Dashboard (Optional)
- [ ] Create basic web UI with Express
- [ ] Display bridge statistics
- [ ] User management interface
- [ ] Federation health monitoring
- [ ] Blocked instances management
- [ ] Recent errors/failures view

---

## Milestone 8: Polish & Production Readiness

### Error Handling
- [ ] Create custom error classes
- [ ] Implement global error handler
- [ ] Add user-friendly error messages for common failures
- [ ] Forward critical errors to admin room
- [ ] Implement graceful degradation for non-critical failures
- [ ] Add circuit breaker for failing remote instances

### Monitoring - Prometheus Metrics
- [ ] Install `prom-client`
- [ ] Create `/metrics` endpoint
- [ ] Add `bridge_messages_total` counter (direction, status)
- [ ] Add `bridge_message_latency_seconds` histogram
- [ ] Add `bridge_users_total` gauge
- [ ] Add `bridge_rooms_total` gauge
- [ ] Add `bridge_queue_depth` gauge per queue
- [ ] Add `bridge_delivery_failures_total` counter
- [ ] Add `bridge_http_requests_total` counter

### Health Checks
- [ ] Implement `/health` endpoint
- [ ] Check database connectivity
- [ ] Check Redis connectivity
- [ ] Check Matrix homeserver connectivity
- [ ] Return degraded status for partial failures

### Performance Optimization
- [ ] Profile database queries
- [ ] Add indexes for slow queries
- [ ] Optimize N+1 query patterns
- [ ] Tune connection pool sizes
- [ ] Implement query result caching
- [ ] Profile and optimize hot paths

### Caching Strategy
- [ ] Cache actor data with TTL
- [ ] Cache public keys with TTL
- [ ] Cache WebFinger results with TTL
- [ ] Implement cache invalidation
- [ ] Add Redis-based distributed cache

### Documentation
- [ ] Create `docs/deployment.md`
- [ ] Document Docker deployment
- [ ] Document systemd deployment
- [ ] Document reverse proxy setup (nginx/Caddy)
- [ ] Create `docs/configuration.md`
- [ ] Document all environment variables
- [ ] Document registration.yaml setup
- [ ] Create `docs/user-guide.md`
- [ ] Document available bot commands
- [ ] Document how to login for double-puppeting
- [ ] Document how to follow AP users
- [ ] Update `README.md` with quick start

### Unit Tests
- [ ] Test configuration validation
- [ ] Test message transformation (Matrix to AP)
- [ ] Test message transformation (AP to Matrix)
- [ ] Test HTTP signature generation
- [ ] Test HTTP signature verification
- [ ] Test mention transformation
- [ ] Test HTML sanitization
- [ ] Test encryption/decryption utilities
- [ ] Test repository methods

### Integration Tests
- [ ] Test Matrix appservice event processing
- [ ] Test ActivityPub inbox processing
- [ ] Test WebFinger responses
- [ ] Test Actor responses
- [ ] Test end-to-end message flow (mocked)
- [ ] Test queue processing

### Federation Tests
- [ ] Set up test Mastodon instance
- [ ] Test WebFinger discovery
- [ ] Test actor fetch from Mastodon
- [ ] Test Follow flow with Mastodon
- [ ] Test Note delivery to Mastodon
- [ ] Test receiving Note from Mastodon
- [ ] Test with Pleroma (if possible)
- [ ] Test with Misskey (if possible)

### Security Audit
- [ ] Run `pnpm audit` for dependency vulnerabilities
- [ ] Review input validation coverage
- [ ] Review HTML sanitization rules
- [ ] Verify HTTP signature implementation
- [ ] Review access token encryption
- [ ] Check for SQL injection vulnerabilities
- [ ] Check for XSS vulnerabilities
- [ ] Review rate limiting effectiveness
- [ ] Document security considerations

### Production Deployment
- [ ] Create production Docker image
- [ ] Document backup procedures for database
- [ ] Configure log aggregation
- [ ] Set up alerting rules
- [ ] Create runbook for common issues
- [ ] Load test with realistic traffic
- [ ] Document scaling considerations

---

## Future Enhancements (Post-MVP)

- [ ] Support for polls
- [ ] Support for events/calendar
- [ ] Profile bio synchronization
- [ ] Custom emoji sync
- [ ] Keyword filters/mutes
- [ ] Scheduled posts
- [ ] Analytics dashboard
- [ ] Multi-homeserver support
- [ ] Horizontal scaling with multiple bridge instances
