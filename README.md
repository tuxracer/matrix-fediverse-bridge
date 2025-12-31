# Matrix-ActivityPub Bridge

A bidirectional bridge between [Matrix](https://matrix.org/) and the [Fediverse](https://en.wikipedia.org/wiki/Fediverse) (Mastodon, Pleroma, Misskey, Pixelfed, and other ActivityPub servers).

## Features

- **Double-puppeting**: Messages appear from your own identity on both platforms
- **Bidirectional messaging**: Send and receive messages across Matrix and ActivityPub
- **Media support**: Images, videos, audio, and file attachments
- **Social features**: Follow/unfollow, reactions, boosts
- **Threading**: Reply chains work across both platforms
- **Content warnings**: Matrix spoilers become ActivityPub content warnings
- **Moderation**: User blocking, instance blocking, and reporting

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- A Matrix homeserver (Synapse or Dendrite)
- A domain with valid TLS certificate

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/matrix-fediverse-bridge
cd matrix-fediverse-bridge

# Install dependencies
pnpm install

# Build
pnpm build

# Copy and edit configuration
cp .env.example .env
# Edit .env with your settings

# Run database migrations
pnpm migrate

# Generate appservice registration
pnpm generate-registration

# Start the bridge
pnpm start
```

### Docker Quick Start

```bash
# Clone and configure
git clone https://github.com/your-org/matrix-fediverse-bridge
cd matrix-fediverse-bridge
cp .env.example .env
# Edit .env

# Start with Docker Compose
docker compose up -d
```

### Register with Matrix Homeserver

1. Copy `registration.yaml` to your homeserver config directory
2. Add to `homeserver.yaml`:
   ```yaml
   app_service_config_files:
     - /path/to/registration.yaml
   ```
3. Restart your homeserver

## Usage

Interact with the bridge bot (`@apbot:yourdomain.com`):

```
!ap help                          # Show all commands
!ap login                         # Enable double-puppeting
!ap follow @user@mastodon.social  # Follow a Fediverse user
!ap unfollow @user@instance       # Unfollow a user
!ap boost                         # Boost a post (reply to it first)
!ap block @user@instance          # Block a user
!ap status                        # Check bridge status
```

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐     ┌─────────────────┐
│  Matrix         │     │           Bridge Server              │     │  ActivityPub    │
│  Homeserver     │◄───►│  ┌────────────────────────────────┐  │◄───►│  Servers        │
│                 │     │  │  Matrix Appservice (Port 9000) │  │     │  (Mastodon,     │
│  (Synapse/      │     │  └────────────────────────────────┘  │     │   Pleroma,      │
│   Dendrite)     │     │  ┌────────────────────────────────┐  │     │   Misskey)      │
│                 │     │  │  ActivityPub Server (Port 8080) │  │     │                 │
└─────────────────┘     │  └────────────────────────────────┘  │     └─────────────────┘
                        │  ┌─────────────┐  ┌─────────────┐    │
                        │  │ PostgreSQL  │  │    Redis    │    │
                        │  └─────────────┘  └─────────────┘    │
                        └──────────────────────────────────────┘
```

## Documentation

- [Deployment Guide](docs/deployment.md) - Production deployment instructions
- [Configuration Reference](docs/configuration.md) - All configuration options
- [User Guide](docs/user-guide.md) - End-user documentation

## Configuration

Key environment variables:

| Variable | Description |
|----------|-------------|
| `MATRIX_HOMESERVER_URL` | Your Matrix homeserver URL |
| `MATRIX_DOMAIN` | Your Matrix domain |
| `AP_DOMAIN` | Public domain for ActivityPub |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ENCRYPTION_KEY` | 32-byte hex key for token encryption |

See [Configuration Reference](docs/configuration.md) for all options.

## Monitoring

The bridge exposes Prometheus metrics at `/metrics`:

- `bridge_messages_total` - Message counts by direction and status
- `bridge_message_latency_seconds` - Processing latency
- `bridge_queue_depth` - Pending jobs per queue
- `bridge_delivery_failures_total` - Failed deliveries by instance

Health endpoint at `/health` returns:
- `healthy` - All systems operational
- `degraded` - Partial functionality
- `unhealthy` - Critical failure

## Development

```bash
# Install dependencies
pnpm install

# Start development mode with hot reload
pnpm dev

# Run tests
pnpm test

# Run linting
pnpm lint

# Type checking
pnpm typecheck
```

### Project Structure

```
src/
├── index.ts              # Entry point
├── config/               # Configuration management
├── matrix/               # Matrix appservice
│   ├── appservice.ts     # Appservice setup
│   ├── events.ts         # Event handlers
│   ├── puppet.ts         # Ghost user management
│   └── commands.ts       # Bot commands
├── activitypub/          # ActivityPub server
│   ├── server.ts         # HTTP server
│   ├── webfinger.ts      # WebFinger endpoint
│   ├── actor.ts          # Actor management
│   ├── inbox.ts          # Inbox processing
│   └── signatures.ts     # HTTP signatures
├── bridge/               # Bridge logic
│   ├── transformer.ts    # Message transformation
│   ├── router.ts         # Message routing
│   ├── media.ts          # Media handling
│   ├── social.ts         # Follow/reaction handling
│   └── moderation.ts     # Moderation features
├── db/                   # Database layer
│   ├── migrations/       # SQL migrations
│   └── repositories/     # Data access
├── queue/                # Job queue
└── utils/                # Utilities
    ├── logger.ts         # Logging
    ├── errors.ts         # Error handling
    ├── metrics.ts        # Prometheus metrics
    ├── health.ts         # Health checks
    └── cache.ts          # Caching
```

## Federation Compatibility

Tested with:
- Mastodon 4.x
- Pleroma
- Misskey
- Pixelfed
- GoToSocial

## Security

- HTTP Signatures for all ActivityPub requests
- Access tokens encrypted at rest
- Rate limiting per remote server
- Instance blocking capability
- Input validation and HTML sanitization

## License

[MIT License](LICENSE)

## Contributing

Contributions welcome! Please read our contributing guidelines first.

## Acknowledgments

Built with:
- [matrix-appservice-bridge](https://github.com/matrix-org/matrix-appservice-bridge)
- [BullMQ](https://github.com/taskforcesh/bullmq)
- [Sharp](https://github.com/lovell/sharp)
