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
- [ ] Create `src/activitypub/server.ts` with Express/Hono
- [ ] Configure JSON-LD content type handling
- [ ] Add `Accept` header parsing for content negotiation
- [ ] Implement request logging
- [ ] Add rate limiting middleware
- [ ] Configure CORS if needed

### WebFinger Endpoint
- [ ] Create `src/activitypub/webfinger.ts`
- [ ] Implement `GET /.well-known/webfinger` endpoint
- [ ] Parse `resource` query parameter (acct: format)
- [ ] Look up Matrix user by AP username
- [ ] Generate JRD response with correct links
- [ ] Add `self` link with `application/activity+json` type
- [ ] Add profile page link
- [ ] Handle user not found (404)
- [ ] Add caching headers

### NodeInfo
- [ ] Implement `GET /.well-known/nodeinfo` discovery endpoint
- [ ] Create `/nodeinfo/2.1` endpoint
- [ ] Include software name and version
- [ ] Include protocol support (activitypub)
- [ ] Include usage statistics (user count, post count)
- [ ] Include open registrations status (false for bridge)

### Host-Meta (Optional)
- [ ] Implement `GET /.well-known/host-meta` endpoint
- [ ] Return XML with WebFinger template

### Actor Management
- [ ] Create `src/activitypub/actor.ts`
- [ ] Implement `GET /users/:username` endpoint
- [ ] Generate Actor JSON-LD structure
- [ ] Include `id`, `type`, `preferredUsername`
- [ ] Include `inbox`, `outbox`, `followers`, `following` URLs
- [ ] Include `publicKey` object with PEM
- [ ] Include `icon` for avatar
- [ ] Include `name` for display name
- [ ] Add content negotiation (JSON-LD vs HTML)

### Key Pair Management
- [ ] Implement RSA key pair generation (4096-bit)
- [ ] Store private key PEM in database
- [ ] Store public key PEM in database
- [ ] Implement key retrieval by actor
- [ ] Create keys on actor first access

### HTTP Signatures
- [ ] Create `src/activitypub/signatures.ts`
- [ ] Implement `signRequest()` function for outbound requests
- [ ] Sign `(request-target)`, `host`, `date`, `digest` headers
- [ ] Implement `verifySignature()` for inbound requests
- [ ] Fetch remote actor public keys
- [ ] Cache public keys with TTL
- [ ] Handle key rotation (refetch on verification failure)
- [ ] Implement `Digest` header generation
- [ ] Implement `Digest` header verification

### Inbox Processing
- [ ] Create `src/activitypub/inbox.ts`
- [ ] Implement `POST /users/:username/inbox` endpoint
- [ ] Implement `POST /inbox` shared inbox endpoint
- [ ] Verify HTTP signature on all requests
- [ ] Validate `Date` header (reject >30s drift)
- [ ] Validate `Digest` header matches body
- [ ] Parse and validate Activity JSON-LD
- [ ] Route activities by type to handlers
- [ ] Implement idempotency (deduplicate by activity ID)

### Activity Handlers (Inbound)
- [ ] Implement `Create` activity handler
- [ ] Implement `Update` activity handler
- [ ] Implement `Delete` activity handler
- [ ] Implement `Like` activity handler
- [ ] Implement `Announce` activity handler
- [ ] Implement `Follow` activity handler
- [ ] Implement `Accept` activity handler (follow acceptance)
- [ ] Implement `Reject` activity handler
- [ ] Implement `Undo` activity handler
- [ ] Implement `Block` activity handler
- [ ] Implement `Add` activity handler
- [ ] Implement `Remove` activity handler

### Outbox
- [ ] Create `src/activitypub/outbox.ts`
- [ ] Implement `GET /users/:username/outbox` endpoint
- [ ] Return OrderedCollection with public activities
- [ ] Implement pagination with `next`/`prev` links
- [ ] Filter to only public activities

### Collections
- [ ] Implement `GET /users/:username/followers` endpoint
- [ ] Implement `GET /users/:username/following` endpoint
- [ ] Return OrderedCollection format
- [ ] Implement pagination

### Object/Activity Lookup
- [ ] Implement `GET /activities/:id` endpoint
- [ ] Implement `GET /objects/:id` endpoint
- [ ] Return 404 for non-existent objects
- [ ] Add authorization checks (public vs private)

---

## Milestone 4: Message Bridging

### Message Transformer
- [ ] Create `src/bridge/transformer.ts`
- [ ] Implement `matrixToAP()` main transformation function
- [ ] Implement `apToMatrix()` main transformation function

### Matrix to ActivityPub Transformation
- [ ] Convert plain text body to Note content
- [ ] Convert formatted HTML body to Note content
- [ ] Sanitize HTML (allowlist safe tags)
- [ ] Transform Matrix mentions `@user:server` to `@user@server`
- [ ] Transform room mentions to hashtags where applicable
- [ ] Handle spoiler tags (`data-mx-spoiler`) to Content Warnings
- [ ] Convert MXC URLs to proxy HTTPS URLs
- [ ] Set `published` timestamp from event
- [ ] Set `attributedTo` to actor URL
- [ ] Determine audience (`to`, `cc`) based on room type
- [ ] Handle custom emoji shortcodes

### ActivityPub to Matrix Transformation
- [ ] Convert Note `content` HTML to Matrix HTML subset
- [ ] Sanitize incoming HTML
- [ ] Strip disallowed tags/attributes
- [ ] Transform `@user@server` mentions to `@user:server`
- [ ] Transform hashtags (preserve or convert)
- [ ] Handle Content Warnings to spoiler format
- [ ] Set `msgtype` appropriately
- [ ] Set `format` to `org.matrix.custom.html` when HTML present
- [ ] Convert remote media URLs to MXC (via upload)

### Reply Threading
- [ ] Extract reply-to from Matrix `m.relates_to.m.in_reply_to`
- [ ] Look up AP object ID for Matrix event ID
- [ ] Set `inReplyTo` field on AP Note
- [ ] Extract `inReplyTo` from AP Note
- [ ] Look up Matrix event ID for AP object ID
- [ ] Set `m.relates_to.m.in_reply_to` on Matrix message
- [ ] Handle missing reply targets gracefully

### Message ID Mapping
- [ ] Create `src/db/repositories/messages.ts`
- [ ] Implement `create()` to store mapping
- [ ] Implement `findByMatrixEventId()` lookup
- [ ] Implement `findByAPObjectId()` lookup
- [ ] Generate deterministic AP object IDs from Matrix events
- [ ] Store bidirectional mappings on message bridge

### Room/Conversation Mapping
- [ ] Create `src/db/repositories/rooms.ts`
- [ ] Implement room type detection (DM, group, public)
- [ ] Map Matrix room ID to AP context ID
- [ ] Create room mapping on first bridged message
- [ ] Implement `findByMatrixRoomId()` lookup

### Message Router
- [ ] Create `src/bridge/router.ts`
- [ ] Detect if message should be bridged
- [ ] Check if sender has AP followers
- [ ] Determine target inboxes for AP delivery
- [ ] Handle DM routing (direct to recipient inbox)
- [ ] Handle public post routing (fan-out to followers)

### Message Queue
- [ ] Create `src/queue/index.ts` BullMQ setup
- [ ] Create Redis connection for queue
- [ ] Define `matrix-to-ap` queue
- [ ] Define `ap-to-matrix` queue
- [ ] Define `ap-delivery` queue
- [ ] Configure queue options (attempts, backoff)

### Queue Workers
- [ ] Create `src/queue/workers/matrixToAP.ts` worker
- [ ] Process Matrix events, transform, enqueue delivery
- [ ] Create `src/queue/workers/apToMatrix.ts` worker
- [ ] Process AP activities, transform, send to Matrix
- [ ] Create `src/queue/workers/apDelivery.ts` worker
- [ ] Deliver activities to remote inboxes

### Delivery System
- [ ] Implement inbox delivery with HTTP signatures
- [ ] Implement shared inbox optimization
- [ ] Handle delivery failures (retry with backoff)
- [ ] Implement exponential backoff (1s, 2s, 4s, 8s...)
- [ ] Configure max retry attempts
- [ ] Implement dead letter queue for permanent failures
- [ ] Track delivery status per inbox
- [ ] Log failed deliveries for debugging

### Fan-out Delivery
- [ ] Fetch follower list for sender
- [ ] Deduplicate by shared inbox
- [ ] Create delivery jobs for each unique inbox
- [ ] Batch deliveries where possible

---

## Milestone 5: Media Handling

### Media Proxy
- [ ] Create `src/bridge/media.ts`
- [ ] Implement `GET /media/:id` proxy endpoint
- [ ] Serve cached media from local storage/S3
- [ ] Implement on-demand fetch for uncached media

### MXC to HTTPS Conversion
- [ ] Parse MXC URLs (`mxc://server/mediaId`)
- [ ] Generate proxy HTTPS URL
- [ ] Create media database record
- [ ] Return proxy URL for AP posts

### HTTPS to MXC Conversion
- [ ] Fetch remote media from AP URL
- [ ] Validate content type matches claimed type
- [ ] Upload to Matrix homeserver via media API
- [ ] Store MXC URL in database
- [ ] Return MXC URL for Matrix messages

### Media Repository
- [ ] Create `src/db/repositories/media.ts`
- [ ] Implement `create()` method
- [ ] Implement `findByMxcUrl()` method
- [ ] Implement `findByAPUrl()` method
- [ ] Implement `findById()` method

### Image Processing
- [ ] Install and configure Sharp
- [ ] Implement thumbnail generation
- [ ] Configure thumbnail dimensions
- [ ] Implement blurhash generation
- [ ] Implement format detection
- [ ] Implement WebP conversion (optional)
- [ ] Implement image dimension extraction

### Media Type Handlers
- [ ] Implement image bridging (`m.image` <-> `Image`)
- [ ] Extract/preserve image dimensions
- [ ] Extract/preserve alt text
- [ ] Implement video bridging (`m.video` <-> `Video`)
- [ ] Implement audio bridging (`m.audio` <-> `Audio`)
- [ ] Implement file bridging (`m.file` <-> `Document`)

### Media Metadata
- [ ] Preserve image dimensions across bridge
- [ ] Preserve video/audio duration
- [ ] Bridge alt text/description
- [ ] Generate blurhash for images without one
- [ ] Include blurhash in AP attachments

### Media Caching
- [ ] Implement LRU cache for frequently accessed media
- [ ] Configure cache TTL
- [ ] Implement cache eviction
- [ ] Add cache headers to proxy responses

---

## Milestone 6: Social Features

### Follow/Unfollow
- [ ] Create `src/db/repositories/follows.ts`
- [ ] Implement `create()` for new follow
- [ ] Implement `findByFollowerAndFollowing()`
- [ ] Implement `updateStatus()` for accept/reject
- [ ] Implement `delete()` for unfollow
- [ ] Implement `findFollowers()` for actor
- [ ] Implement `findFollowing()` for actor

### Follow Commands
- [ ] Implement `!ap follow @user@instance` command
- [ ] Parse AP handle from command
- [ ] Resolve handle via WebFinger
- [ ] Fetch remote actor
- [ ] Create Follow activity
- [ ] Sign and deliver to remote inbox
- [ ] Store pending follow in database

### Follow Activity Handling
- [ ] Handle inbound `Follow` activity
- [ ] Auto-accept follows (configurable)
- [ ] Generate `Accept` activity
- [ ] Deliver Accept to follower inbox
- [ ] Update follow status in database

### Unfollow
- [ ] Implement `!ap unfollow @user@instance` command
- [ ] Create `Undo` activity wrapping original Follow
- [ ] Deliver to remote inbox
- [ ] Remove follow from database

### Reactions
- [ ] Handle `m.reaction` Matrix events
- [ ] Extract emoji from reaction
- [ ] Look up AP object ID for reacted message
- [ ] Create `Like` activity
- [ ] Deliver to post author inbox

### Inbound Reactions
- [ ] Handle inbound `Like` activity
- [ ] Look up Matrix event ID for liked object
- [ ] Create `m.reaction` event
- [ ] Send via puppet or bot

### Reaction Undo
- [ ] Handle `m.redaction` of reactions
- [ ] Create `Undo` activity for Like
- [ ] Deliver undo to original recipient
- [ ] Handle inbound `Undo` of `Like`
- [ ] Redact corresponding Matrix reaction

### Boosts/Announces
- [ ] Handle inbound `Announce` activity
- [ ] Fetch announced object if not cached
- [ ] Create Matrix message representing boost
- [ ] Include boost attribution
- [ ] Implement `!ap boost` command
- [ ] Create `Announce` activity
- [ ] Deliver to followers

### Boost Undo
- [ ] Implement `!ap unboost` command
- [ ] Create `Undo` activity for Announce
- [ ] Handle inbound `Undo` of `Announce`

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
