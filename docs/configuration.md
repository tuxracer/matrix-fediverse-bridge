# Configuration Reference

This document describes all configuration options for the Matrix-ActivityPub bridge.

## Environment Variables

All configuration is done through environment variables. Create a `.env` file or set them in your deployment environment.

### Matrix Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MATRIX_HOMESERVER_URL` | Yes | - | URL of your Matrix homeserver (e.g., `https://matrix.example.com`) |
| `MATRIX_DOMAIN` | Yes | - | Your Matrix server's domain (e.g., `example.com`) |
| `MATRIX_APPSERVICE_TOKEN` | Yes | - | The `as_token` from registration.yaml |
| `MATRIX_HOMESERVER_TOKEN` | Yes | - | The `hs_token` from registration.yaml |
| `MATRIX_APPSERVICE_PORT` | No | `9000` | Port for the appservice HTTP server |
| `MATRIX_APPSERVICE_BIND` | No | `0.0.0.0` | Address to bind the appservice server |

### ActivityPub Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AP_DOMAIN` | Yes | - | Public domain for ActivityPub (e.g., `bridge.example.com`) |
| `AP_BASE_URL` | No | `https://{AP_DOMAIN}` | Full base URL for ActivityPub endpoints |
| `AP_PORT` | No | `8080` | Port for the ActivityPub HTTP server |
| `AP_BIND` | No | `0.0.0.0` | Address to bind the AP server |

### Database Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `DATABASE_POOL_MIN` | No | `2` | Minimum pool connections |
| `DATABASE_POOL_MAX` | No | `10` | Maximum pool connections |
| `DATABASE_SSL` | No | `false` | Enable SSL for database connection |

Example connection strings:
```bash
# Local development
DATABASE_URL=postgresql://user:password@localhost:5432/bridge

# With SSL
DATABASE_URL=postgresql://user:password@db.example.com:5432/bridge?sslmode=require

# Docker Compose
DATABASE_URL=postgresql://bridge:bridge@postgres:5432/bridge
```

### Redis Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | Yes | - | Redis connection string |
| `REDIS_PREFIX` | No | `bridge:` | Key prefix for Redis entries |

Example:
```bash
REDIS_URL=redis://localhost:6379
REDIS_URL=redis://:password@redis.example.com:6379/0
```

### Security Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENCRYPTION_KEY` | Yes | - | 32-byte hex key for encrypting access tokens |
| `ADMIN_USERS` | No | - | Comma-separated Matrix user IDs for admins |
| `BLOCKED_INSTANCES` | No | - | Comma-separated domains to block |
| `RATE_LIMIT_PER_SERVER` | No | `100` | Requests per minute per remote server |

Generate an encryption key:
```bash
openssl rand -hex 32
```

Example:
```bash
ENCRYPTION_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
ADMIN_USERS=@admin:example.com,@moderator:example.com
BLOCKED_INSTANCES=spam.instance,bad.actor.social
```

### Logging Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | No | `info` | Log level: `error`, `warn`, `info`, `debug`, `trace` |
| `LOG_FORMAT` | No | `json` | Log format: `json` or `pretty` |
| `LOG_TIMESTAMPS` | No | `true` | Include timestamps in logs |

### Feature Flags

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTO_ACCEPT_FOLLOWS` | No | `true` | Auto-accept incoming follow requests |
| `ENABLE_DOUBLE_PUPPET` | No | `true` | Enable double-puppeting feature |
| `ENABLE_MEDIA_PROXY` | No | `true` | Enable media proxying |
| `GENERATE_BLURHASH` | No | `true` | Generate blurhash for images |
| `GENERATE_THUMBNAILS` | No | `true` | Generate thumbnails for images |

### Queue Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QUEUE_CONCURRENCY` | No | `5` | Concurrent job processing |
| `QUEUE_MAX_RETRIES` | No | `3` | Maximum retry attempts |
| `QUEUE_RETRY_DELAY` | No | `60000` | Retry delay in milliseconds |

## Appservice Registration

The bridge requires registration with your Matrix homeserver.

### Generate Registration

```bash
pnpm run generate-registration
```

This creates `registration.yaml`:

```yaml
id: activitypub-bridge
url: http://localhost:9000
as_token: <generated-token>
hs_token: <generated-token>
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

### Registration Fields

| Field | Description |
|-------|-------------|
| `id` | Unique identifier for the appservice |
| `url` | URL where the homeserver can reach the appservice |
| `as_token` | Token the appservice uses to authenticate to the homeserver |
| `hs_token` | Token the homeserver uses to authenticate to the appservice |
| `sender_localpart` | Local part of the bot user (e.g., `apbot` for `@apbot:example.com`) |
| `namespaces.users` | User ID patterns the appservice controls |
| `namespaces.rooms` | Room ID patterns the appservice controls |
| `namespaces.aliases` | Room alias patterns the appservice controls |

### Synapse Configuration

Add to `homeserver.yaml`:

```yaml
app_service_config_files:
  - /path/to/registration.yaml
```

### Dendrite Configuration

Add to `dendrite.yaml`:

```yaml
app_service_api:
  config_files:
    - /path/to/registration.yaml
```

## Example Configurations

### Minimal Production

```bash
# Matrix
MATRIX_HOMESERVER_URL=https://matrix.example.com
MATRIX_DOMAIN=example.com
MATRIX_APPSERVICE_TOKEN=as_token_from_registration
MATRIX_HOMESERVER_TOKEN=hs_token_from_registration

# ActivityPub
AP_DOMAIN=bridge.example.com

# Database
DATABASE_URL=postgresql://bridge:secretpassword@localhost:5432/bridge

# Redis
REDIS_URL=redis://localhost:6379

# Security
ENCRYPTION_KEY=your-32-byte-hex-key-here
ADMIN_USERS=@admin:example.com
```

### Full Production

```bash
# Matrix
MATRIX_HOMESERVER_URL=https://matrix.example.com
MATRIX_DOMAIN=example.com
MATRIX_APPSERVICE_TOKEN=as_token_from_registration
MATRIX_HOMESERVER_TOKEN=hs_token_from_registration
MATRIX_APPSERVICE_PORT=9000
MATRIX_APPSERVICE_BIND=127.0.0.1

# ActivityPub
AP_DOMAIN=bridge.example.com
AP_BASE_URL=https://bridge.example.com
AP_PORT=8080
AP_BIND=127.0.0.1

# Database
DATABASE_URL=postgresql://bridge:secretpassword@db.internal:5432/bridge?sslmode=require
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20
DATABASE_SSL=true

# Redis
REDIS_URL=redis://:redispassword@redis.internal:6379/0
REDIS_PREFIX=ap-bridge:

# Security
ENCRYPTION_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
ADMIN_USERS=@admin:example.com,@mod:example.com
BLOCKED_INSTANCES=spam.social,bad-actor.instance
RATE_LIMIT_PER_SERVER=50

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Features
AUTO_ACCEPT_FOLLOWS=true
ENABLE_DOUBLE_PUPPET=true
ENABLE_MEDIA_PROXY=true
GENERATE_BLURHASH=true
GENERATE_THUMBNAILS=true

# Queue
QUEUE_CONCURRENCY=10
QUEUE_MAX_RETRIES=5
QUEUE_RETRY_DELAY=30000
```

### Docker Compose Development

```bash
# Matrix (using local Synapse)
MATRIX_HOMESERVER_URL=http://synapse:8008
MATRIX_DOMAIN=localhost
MATRIX_APPSERVICE_TOKEN=development_as_token
MATRIX_HOMESERVER_TOKEN=development_hs_token

# ActivityPub
AP_DOMAIN=localhost:8080
AP_BASE_URL=http://localhost:8080

# Database
DATABASE_URL=postgresql://bridge:bridge@postgres:5432/bridge

# Redis
REDIS_URL=redis://redis:6379

# Security (development only!)
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
ADMIN_USERS=@admin:localhost

# Logging
LOG_LEVEL=debug
LOG_FORMAT=pretty
```

## Configuration Validation

The bridge validates all configuration on startup using Zod schemas. Invalid configuration will prevent startup with descriptive error messages.

Common validation errors:

```
ConfigurationError: Invalid MATRIX_HOMESERVER_URL: must be a valid URL
ConfigurationError: ENCRYPTION_KEY must be exactly 64 hex characters
ConfigurationError: DATABASE_URL is required
```

## Hot Reloading

The following settings can be changed without restart by sending SIGHUP:

- `LOG_LEVEL`
- `BLOCKED_INSTANCES`
- `RATE_LIMIT_PER_SERVER`

```bash
kill -HUP $(pgrep -f "node.*matrix-ap-bridge")
```

## Secrets Management

For production, consider using a secrets manager:

### Docker Secrets

```yaml
services:
  bridge:
    secrets:
      - db_password
      - encryption_key

secrets:
  db_password:
    file: ./secrets/db_password.txt
  encryption_key:
    file: ./secrets/encryption_key.txt
```

### HashiCorp Vault

```bash
export DATABASE_URL=$(vault kv get -field=url secret/bridge/database)
export ENCRYPTION_KEY=$(vault kv get -field=key secret/bridge/encryption)
```

### AWS Secrets Manager

Use the AWS SDK to fetch secrets at startup, or use ECS task definition secrets.
