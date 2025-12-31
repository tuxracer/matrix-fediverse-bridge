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
    # Source the .env file to get tokens
    set -a
    source "$PROJECT_DIR/.env"
    set +a
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
