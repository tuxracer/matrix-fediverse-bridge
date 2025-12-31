# Docker Setup Guide - Complete End-to-End Installation

This guide walks you through setting up the Matrix-ActivityPub bridge with all required services using Docker Compose.

## Prerequisites

- Docker Engine 24.0+ and Docker Compose v2
- At least 4GB RAM available for containers
- Ports available: 5432 (PostgreSQL), 6379 (Redis), 8008 (Synapse), 8080 (ActivityPub), 9000 (Appservice)
- For federation testing: a domain with HTTPS (or use a tunneling service like ngrok)

## Quick Start

```bash
# Clone and enter the project
cd matrix-fediverse-bridge

# Run the setup script
./docker/setup.sh

# Start all services
docker compose -f docker/docker-compose.yml --profile full up -d

# View logs
docker compose -f docker/docker-compose.yml logs -f bridge
```

## Step-by-Step Setup

### Step 1: Generate Security Tokens

Generate the required tokens for appservice authentication:

```bash
# Generate appservice token (AS uses this to talk to homeserver)
AS_TOKEN=$(openssl rand -hex 32)
echo "AS_TOKEN: $AS_TOKEN"

# Generate homeserver token (HS uses this to talk to appservice)
HS_TOKEN=$(openssl rand -hex 32)
echo "HS_TOKEN: $HS_TOKEN"

# Generate encryption key for access token storage
ENCRYPTION_KEY=$(openssl rand -hex 32)
echo "ENCRYPTION_KEY: $ENCRYPTION_KEY"
```

Save these values - you'll need them in the next steps.

### Step 2: Create Environment Configuration

Create your `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Node Environment
NODE_ENV=development

# Matrix Configuration
MATRIX_HOMESERVER_URL=http://synapse:8008
MATRIX_DOMAIN=localhost
MATRIX_APPSERVICE_TOKEN=<paste-AS_TOKEN-here>
MATRIX_HOMESERVER_TOKEN=<paste-HS_TOKEN-here>
MATRIX_APPSERVICE_PORT=9000
MATRIX_SENDER_LOCALPART=apbot

# ActivityPub Configuration
AP_DOMAIN=localhost:8080
AP_PORT=8080

# Database Configuration
DATABASE_URL=postgresql://bridge:bridge_dev_password@postgres:5432/matrix_ap_bridge
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Redis Configuration
REDIS_URL=redis://redis:6379

# Security Configuration
ENCRYPTION_KEY=<paste-ENCRYPTION_KEY-here>
BLOCKED_INSTANCES=
RATE_LIMIT_PER_MINUTE=100

# Logging Configuration
LOG_LEVEL=debug
LOG_FORMAT=pretty
```

### Step 3: Create Appservice Registration

Create the registration file that Synapse will use:

```bash
cp registration.example.yaml docker/synapse-config/registration.yaml
```

Edit `docker/synapse-config/registration.yaml`:

```yaml
id: activitypub-bridge

# URL where Synapse can reach the bridge (container name within Docker network)
url: http://bridge:9000

# Paste your generated tokens here
as_token: <paste-AS_TOKEN-here>
hs_token: <paste-HS_TOKEN-here>

sender_localpart: apbot

namespaces:
  users:
    - exclusive: true
      regex: '@_ap_.*:localhost'
  rooms:
    - exclusive: true
      regex: '#_ap_.*:localhost'
  aliases:
    - exclusive: true
      regex: '#ap_.*:localhost'

rate_limited: false

protocols:
  - activitypub

de.sorunome.msc2409.push_ephemeral: false
push_ephemeral: false
```

**Important:** The `as_token` and `hs_token` MUST match the values in your `.env` file.

### Step 4: Create Synapse Configuration

Create the Synapse homeserver configuration:

```bash
mkdir -p docker/synapse-config
```

Create `docker/synapse-config/homeserver.yaml`:

```yaml
# Synapse Configuration for Bridge Development

server_name: "localhost"
pid_file: /data/homeserver.pid
public_baseurl: http://localhost:8008/

listeners:
  - port: 8008
    tls: false
    type: http
    x_forwarded: true
    bind_addresses: ['0.0.0.0']
    resources:
      - names: [client, federation]
        compress: false

database:
  name: psycopg2
  args:
    user: bridge
    password: bridge_dev_password
    database: synapse
    host: postgres
    cp_min: 5
    cp_max: 10

log_config: "/data/localhost.log.config"

media_store_path: /data/media_store
uploads_path: /data/uploads

registration_shared_secret: "dev-registration-secret-change-in-production"

macaroon_secret_key: "dev-macaroon-secret-change-in-production"
form_secret: "dev-form-secret-change-in-production"

signing_key_path: "/data/localhost.signing.key"

trusted_key_servers:
  - server_name: "matrix.org"

enable_registration: true
enable_registration_without_verification: true

# Appservice configuration - register the bridge
app_service_config_files:
  - /config/registration.yaml

# Suppress federation for local development
federation_domain_whitelist: []

# Allow connecting to localhost for appservice
ip_range_whitelist:
  - '127.0.0.1'
  - '10.0.0.0/8'
  - '172.16.0.0/12'
  - '192.168.0.0/16'

# Relax URL preview restrictions for development
url_preview_enabled: false

# Development settings
suppress_key_server_warning: true
```

Create `docker/synapse-config/localhost.log.config`:

```yaml
version: 1

formatters:
  precise:
    format: '%(asctime)s - %(name)s - %(lineno)d - %(levelname)s - %(message)s'

handlers:
  console:
    class: logging.StreamHandler
    formatter: precise

loggers:
  synapse.storage.SQL:
    level: WARNING

root:
  level: INFO
  handlers: [console]

disable_existing_loggers: false
```

### Step 5: Update Docker Compose

Update `docker/docker-compose.yml` to include all necessary configuration:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: bridge-postgres
    environment:
      POSTGRES_USER: bridge
      POSTGRES_PASSWORD: bridge_dev_password
      POSTGRES_DB: matrix_ap_bridge
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U bridge -d matrix_ap_bridge']
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - bridge-network

  redis:
    image: redis:7-alpine
    container_name: bridge-redis
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - bridge-network

  synapse:
    image: matrixdotorg/synapse:latest
    container_name: bridge-synapse
    environment:
      SYNAPSE_CONFIG_PATH: /config/homeserver.yaml
    ports:
      - '8008:8008'
    volumes:
      - synapse_data:/data
      - ./synapse-config:/config:ro
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8008/health']
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - bridge-network

  bridge:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    container_name: bridge-app
    env_file:
      - ../.env
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://bridge:bridge_dev_password@postgres:5432/matrix_ap_bridge
      REDIS_URL: redis://redis:6379
      MATRIX_HOMESERVER_URL: http://synapse:8008
    ports:
      - '8080:8080'
      - '9000:9000'
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      synapse:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:8080/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    networks:
      - bridge-network
    profiles:
      - full

volumes:
  postgres_data:
  redis_data:
  synapse_data:

networks:
  bridge-network:
    driver: bridge
```

### Step 6: Create Database Initialization Script

Create `docker/init-db.sql` to set up both databases:

```sql
-- Create Synapse database
CREATE DATABASE synapse;
GRANT ALL PRIVILEGES ON DATABASE synapse TO bridge;

-- The matrix_ap_bridge database is created by default POSTGRES_DB
-- Bridge migrations will handle table creation
```

### Step 7: Create Setup Script

Create `docker/setup.sh`:

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Matrix-ActivityPub Bridge Setup ==="
echo

# Check for required tools
command -v docker >/dev/null 2>&1 || { echo "Docker is required but not installed. Aborting."; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "OpenSSL is required but not installed. Aborting."; exit 1; }

# Generate tokens if .env doesn't exist
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "Generating security tokens..."
    AS_TOKEN=$(openssl rand -hex 32)
    HS_TOKEN=$(openssl rand -hex 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)

    echo "Creating .env file..."
    cat > "$PROJECT_DIR/.env" << EOF
# Node Environment
NODE_ENV=development

# Matrix Configuration
MATRIX_HOMESERVER_URL=http://synapse:8008
MATRIX_DOMAIN=localhost
MATRIX_APPSERVICE_TOKEN=$AS_TOKEN
MATRIX_HOMESERVER_TOKEN=$HS_TOKEN
MATRIX_APPSERVICE_PORT=9000
MATRIX_SENDER_LOCALPART=apbot

# ActivityPub Configuration
AP_DOMAIN=localhost:8080
AP_PORT=8080

# Database Configuration
DATABASE_URL=postgresql://bridge:bridge_dev_password@postgres:5432/matrix_ap_bridge
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Redis Configuration
REDIS_URL=redis://redis:6379

# Security Configuration
ENCRYPTION_KEY=$ENCRYPTION_KEY
BLOCKED_INSTANCES=
RATE_LIMIT_PER_MINUTE=100

# Admin Configuration (your Matrix user ID for admin commands)
ADMIN_USERS=@admin:localhost

# Logging Configuration
LOG_LEVEL=debug
LOG_FORMAT=pretty
EOF
    echo "Created .env with generated tokens"
else
    echo ".env already exists, loading tokens..."
    source "$PROJECT_DIR/.env"
    AS_TOKEN=$MATRIX_APPSERVICE_TOKEN
    HS_TOKEN=$MATRIX_HOMESERVER_TOKEN
fi

# Create registration.yaml
echo "Creating appservice registration..."
mkdir -p "$SCRIPT_DIR/synapse-config"
cat > "$SCRIPT_DIR/synapse-config/registration.yaml" << EOF
id: activitypub-bridge
url: http://bridge:9000
as_token: $AS_TOKEN
hs_token: $HS_TOKEN
sender_localpart: apbot

namespaces:
  users:
    - exclusive: true
      regex: '@_ap_.*:localhost'
  rooms:
    - exclusive: true
      regex: '#_ap_.*:localhost'
  aliases:
    - exclusive: true
      regex: '#ap_.*:localhost'

rate_limited: false
protocols:
  - activitypub

de.sorunome.msc2409.push_ephemeral: false
push_ephemeral: false
EOF
echo "Created registration.yaml"

# Create Synapse config if it doesn't exist
if [ ! -f "$SCRIPT_DIR/synapse-config/homeserver.yaml" ]; then
    echo "Creating Synapse configuration..."
    cat > "$SCRIPT_DIR/synapse-config/homeserver.yaml" << 'EOF'
server_name: "localhost"
pid_file: /data/homeserver.pid
public_baseurl: http://localhost:8008/

listeners:
  - port: 8008
    tls: false
    type: http
    x_forwarded: true
    bind_addresses: ['0.0.0.0']
    resources:
      - names: [client, federation]
        compress: false

database:
  name: psycopg2
  args:
    user: bridge
    password: bridge_dev_password
    database: synapse
    host: postgres
    cp_min: 5
    cp_max: 10

log_config: "/data/localhost.log.config"
media_store_path: /data/media_store
uploads_path: /data/uploads

registration_shared_secret: "dev-registration-secret-change-in-production"
macaroon_secret_key: "dev-macaroon-secret-change-in-production"
form_secret: "dev-form-secret-change-in-production"
signing_key_path: "/data/localhost.signing.key"

trusted_key_servers:
  - server_name: "matrix.org"

enable_registration: true
enable_registration_without_verification: true

app_service_config_files:
  - /config/registration.yaml

federation_domain_whitelist: []

ip_range_whitelist:
  - '127.0.0.1'
  - '10.0.0.0/8'
  - '172.16.0.0/12'
  - '192.168.0.0/16'

url_preview_enabled: false
suppress_key_server_warning: true
EOF
    echo "Created homeserver.yaml"
fi

# Create log config
if [ ! -f "$SCRIPT_DIR/synapse-config/localhost.log.config" ]; then
    cat > "$SCRIPT_DIR/synapse-config/localhost.log.config" << 'EOF'
version: 1

formatters:
  precise:
    format: '%(asctime)s - %(name)s - %(lineno)d - %(levelname)s - %(message)s'

handlers:
  console:
    class: logging.StreamHandler
    formatter: precise

loggers:
  synapse.storage.SQL:
    level: WARNING

root:
  level: INFO
  handlers: [console]

disable_existing_loggers: false
EOF
    echo "Created log config"
fi

# Create init-db.sql if it doesn't exist
if [ ! -f "$SCRIPT_DIR/init-db.sql" ]; then
    cat > "$SCRIPT_DIR/init-db.sql" << 'EOF'
-- Create Synapse database
CREATE DATABASE synapse;
GRANT ALL PRIVILEGES ON DATABASE synapse TO bridge;
EOF
    echo "Created init-db.sql"
fi

echo
echo "=== Setup Complete ==="
echo
echo "To start all services:"
echo "  docker compose -f docker/docker-compose.yml --profile full up -d"
echo
echo "To view logs:"
echo "  docker compose -f docker/docker-compose.yml logs -f"
echo
echo "To create a Matrix user for testing:"
echo "  docker exec -it bridge-synapse register_new_matrix_user -c /config/homeserver.yaml -u testuser -p password -a http://localhost:8008"
echo
echo "Services will be available at:"
echo "  - Matrix (Synapse):  http://localhost:8008"
echo "  - ActivityPub:       http://localhost:8080"
echo "  - Bridge Appservice: http://localhost:9000"
echo "  - PostgreSQL:        localhost:5432"
echo "  - Redis:             localhost:6379"
```

Make it executable:

```bash
chmod +x docker/setup.sh
```

### Step 8: Start the Services

```bash
# Run setup (creates configs and tokens)
./docker/setup.sh

# Start infrastructure services first
docker compose -f docker/docker-compose.yml up -d postgres redis

# Wait for them to be healthy
docker compose -f docker/docker-compose.yml ps

# Start Synapse (needs to generate signing key on first run)
docker compose -f docker/docker-compose.yml up -d synapse

# Wait for Synapse to be ready (check logs)
docker compose -f docker/docker-compose.yml logs -f synapse

# Once Synapse shows "Synapse now listening on", start the bridge
docker compose -f docker/docker-compose.yml --profile full up -d bridge

# View all logs
docker compose -f docker/docker-compose.yml --profile full logs -f
```

## Testing the Setup

### 1. Verify Services Are Running

```bash
docker compose -f docker/docker-compose.yml --profile full ps
```

All services should show as "healthy" or "running".

### 2. Check Health Endpoints

```bash
# Check bridge health
curl http://localhost:8080/health

# Check Synapse health
curl http://localhost:8008/health

# Check bridge ActivityPub discovery
curl http://localhost:8080/.well-known/nodeinfo
```

### 3. Create a Test Matrix User

```bash
# Register a new user (use the shared secret from homeserver.yaml)
docker exec -it bridge-synapse register_new_matrix_user \
  -c /config/homeserver.yaml \
  -u testuser \
  -p testpassword \
  --admin \
  http://localhost:8008
```

### 4. Connect with a Matrix Client

Use Element or another Matrix client:

1. Open https://app.element.io
2. Click "Sign In"
3. Click "Edit" on the homeserver field
4. Enter: `http://localhost:8008`
5. Sign in with `testuser` / `testpassword`

### 5. Test the Bridge Bot

1. Create a new DM with `@apbot:localhost`
2. Send: `!ap help`
3. You should see the list of available commands

### 6. Test WebFinger Discovery

```bash
# Test WebFinger for a Matrix user
curl "http://localhost:8080/.well-known/webfinger?resource=acct:testuser@localhost:8080"
```

## Federation Testing (Advanced)

To test actual federation with Mastodon/Pleroma, you need:

1. **HTTPS with a valid domain** - Use ngrok or similar:

```bash
# Expose ActivityPub server
ngrok http 8080

# Note the https URL (e.g., https://abc123.ngrok.io)
```

2. **Update configuration** with your public URL:

```bash
# In .env
AP_DOMAIN=abc123.ngrok.io
AP_PORT=443

# Rebuild bridge
docker compose -f docker/docker-compose.yml --profile full up -d --build bridge
```

3. **Test from Mastodon**:
   - Search for `@testuser@abc123.ngrok.io`
   - The bridge should respond with the user's Actor profile

## Development Workflow

### Rebuilding After Code Changes

```bash
# Rebuild just the bridge
docker compose -f docker/docker-compose.yml --profile full build bridge

# Restart with new code
docker compose -f docker/docker-compose.yml --profile full up -d bridge
```

### Running Migrations

```bash
# Migrations run automatically on startup, but you can run manually:
docker exec -it bridge-app node dist/db/migrate.js
```

### Viewing Logs

```bash
# All services
docker compose -f docker/docker-compose.yml --profile full logs -f

# Specific service
docker compose -f docker/docker-compose.yml logs -f bridge
docker compose -f docker/docker-compose.yml logs -f synapse

# Last 100 lines
docker compose -f docker/docker-compose.yml logs --tail=100 bridge
```

### Accessing Databases

```bash
# PostgreSQL (bridge database)
docker exec -it bridge-postgres psql -U bridge -d matrix_ap_bridge

# PostgreSQL (synapse database)
docker exec -it bridge-postgres psql -U bridge -d synapse

# Redis CLI
docker exec -it bridge-redis redis-cli
```

### Stopping Services

```bash
# Stop all services
docker compose -f docker/docker-compose.yml --profile full down

# Stop and remove volumes (WARNING: deletes all data)
docker compose -f docker/docker-compose.yml --profile full down -v
```

## Troubleshooting

### Bridge Can't Connect to Synapse

```bash
# Check if Synapse is healthy
docker compose -f docker/docker-compose.yml logs synapse | tail -50

# Verify registration.yaml tokens match .env
cat docker/synapse-config/registration.yaml
cat .env | grep TOKEN
```

### Synapse Fails to Start

```bash
# Check for configuration errors
docker compose -f docker/docker-compose.yml logs synapse

# Common issues:
# - Invalid YAML syntax in homeserver.yaml
# - Database connection failed (postgres not ready)
# - Missing signing key (first run takes time to generate)
```

### Database Connection Errors

```bash
# Check PostgreSQL is running
docker compose -f docker/docker-compose.yml ps postgres

# Check connectivity
docker exec -it bridge-app sh -c 'nc -zv postgres 5432'

# Verify databases exist
docker exec -it bridge-postgres psql -U bridge -c '\l'
```

### Redis Connection Errors

```bash
# Check Redis is running
docker compose -f docker/docker-compose.yml ps redis

# Test Redis
docker exec -it bridge-redis redis-cli ping
```

### Token Mismatch Errors

If you see "Invalid token" errors:

1. Regenerate tokens with `openssl rand -hex 32`
2. Update both `.env` AND `docker/synapse-config/registration.yaml`
3. Restart both Synapse and the bridge

### Ports Already in Use

```bash
# Find what's using a port
lsof -i :8008

# Use different ports in docker-compose.yml
ports:
  - '18008:8008'  # Map to different host port
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Docker Network (bridge-network)              │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │   PostgreSQL │  │    Redis     │  │        Synapse         │ │
│  │   (5432)     │  │    (6379)    │  │        (8008)          │ │
│  │              │  │              │  │                        │ │
│  │  - synapse   │  │  - queues    │  │  Matrix Homeserver     │ │
│  │  - bridge    │  │  - cache     │  │  + Appservice Config   │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬────────────┘ │
│         │                 │                      │              │
│         └────────────┬────┴──────────────────────┘              │
│                      │                                          │
│              ┌───────▼────────┐                                 │
│              │     Bridge     │                                 │
│              │                │                                 │
│              │  - AP (8080)   │◄──── ActivityPub Federation     │
│              │  - AS (9000)   │◄──── Matrix Appservice API      │
│              └────────────────┘                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Next Steps

Once your setup is working:

1. **Configure admin users** in `.env` to use admin commands
2. **Set up HTTPS** for production federation
3. **Configure backups** for PostgreSQL data
4. **Set up monitoring** using the `/metrics` endpoint (Prometheus format)
5. **Review security settings** before exposing to the internet
