# Deployment Guide

This guide covers deploying the Matrix-ActivityPub bridge in production environments.

## Prerequisites

- Node.js 20 LTS or later
- PostgreSQL 15+
- Redis 7+
- A Matrix homeserver (Synapse or Dendrite)
- A domain name with valid TLS certificate
- Reverse proxy (nginx, Caddy, or similar)

## Deployment Options

### Docker Deployment (Recommended)

#### 1. Build the Docker Image

```bash
docker build -t matrix-ap-bridge:latest .
```

#### 2. Create Environment File

Create a `.env` file with your configuration (see [Configuration Guide](configuration.md)):

```bash
cp .env.example .env
# Edit .env with your values
```

#### 3. Start with Docker Compose

```bash
docker compose up -d
```

This starts:
- The bridge application
- PostgreSQL database
- Redis cache/queue

#### 4. Register the Appservice

Copy the generated `registration.yaml` to your Matrix homeserver:

```bash
docker cp matrix-ap-bridge:/app/registration.yaml /etc/synapse/
```

Add to your Synapse `homeserver.yaml`:

```yaml
app_service_config_files:
  - /etc/synapse/registration.yaml
```

Restart Synapse:

```bash
systemctl restart synapse
```

### Docker Compose Configuration

The default `docker-compose.yml` provides a complete setup:

```yaml
version: '3.8'

services:
  bridge:
    build: .
    ports:
      - "9000:9000"   # Matrix appservice
      - "8080:8080"   # ActivityPub server
    environment:
      - DATABASE_URL=postgresql://bridge:bridge@postgres:5432/bridge
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: bridge
      POSTGRES_PASSWORD: bridge
      POSTGRES_DB: bridge
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Systemd Deployment

#### 1. Install Dependencies

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm
```

#### 2. Create Bridge User

```bash
sudo useradd -r -s /bin/false -d /opt/matrix-ap-bridge bridge
sudo mkdir -p /opt/matrix-ap-bridge
sudo chown bridge:bridge /opt/matrix-ap-bridge
```

#### 3. Install the Bridge

```bash
cd /opt/matrix-ap-bridge
sudo -u bridge git clone https://github.com/your-org/matrix-fediverse-bridge .
sudo -u bridge pnpm install --frozen-lockfile
sudo -u bridge pnpm build
```

#### 4. Create Systemd Service

Create `/etc/systemd/system/matrix-ap-bridge.service`:

```ini
[Unit]
Description=Matrix-ActivityPub Bridge
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=bridge
Group=bridge
WorkingDirectory=/opt/matrix-ap-bridge
EnvironmentFile=/opt/matrix-ap-bridge/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/matrix-ap-bridge/data

[Install]
WantedBy=multi-user.target
```

#### 5. Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable matrix-ap-bridge
sudo systemctl start matrix-ap-bridge
```

#### 6. Check Status

```bash
sudo systemctl status matrix-ap-bridge
sudo journalctl -u matrix-ap-bridge -f
```

## Reverse Proxy Setup

The bridge requires a reverse proxy to:
- Terminate TLS for ActivityPub federation
- Route requests to the appropriate service

### Nginx Configuration

```nginx
# ActivityPub endpoints (public-facing)
server {
    listen 443 ssl http2;
    server_name bridge.example.com;

    ssl_certificate /etc/letsencrypt/live/bridge.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bridge.example.com/privkey.pem;

    # WebFinger and NodeInfo
    location /.well-known/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ActivityPub endpoints
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for ActivityPub
        proxy_set_header Accept "application/activity+json";
    }

    # Health check endpoint
    location /health {
        proxy_pass http://127.0.0.1:8080;
        access_log off;
    }

    # Metrics endpoint (restrict access)
    location /metrics {
        proxy_pass http://127.0.0.1:8080;
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;
    }
}

# Matrix appservice (internal only)
# This should NOT be exposed publicly
# Configure your Matrix homeserver to connect directly
```

### Caddy Configuration

```caddyfile
bridge.example.com {
    # ActivityPub server
    reverse_proxy localhost:8080

    # Restrict metrics to internal networks
    @metrics path /metrics
    handle @metrics {
        @allowed remote_ip 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16
        reverse_proxy @allowed localhost:8080
        respond 403
    }
}
```

## Database Setup

### PostgreSQL Configuration

For production, tune PostgreSQL for your workload:

```sql
-- Recommended settings in postgresql.conf
shared_buffers = 256MB
effective_cache_size = 768MB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 4MB
min_wal_size = 1GB
max_wal_size = 4GB
max_worker_processes = 4
max_parallel_workers_per_gather = 2
max_parallel_workers = 4
```

### Run Migrations

Migrations run automatically on startup, or manually:

```bash
pnpm run migrate
```

### Backup Strategy

```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d)
pg_dump -h localhost -U bridge bridge | gzip > /backups/bridge_$DATE.sql.gz

# Keep last 30 days
find /backups -name "bridge_*.sql.gz" -mtime +30 -delete
```

## Redis Configuration

For production Redis:

```conf
# /etc/redis/redis.conf
maxmemory 256mb
maxmemory-policy allkeys-lru
appendonly yes
appendfsync everysec
```

## Monitoring

### Prometheus Scrape Config

```yaml
scrape_configs:
  - job_name: 'matrix-ap-bridge'
    static_configs:
      - targets: ['bridge.example.com:8080']
    metrics_path: /metrics
    scheme: https
```

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `bridge_messages_total` | Message volume | Sudden drops |
| `bridge_message_latency_seconds` | Processing time | p99 > 5s |
| `bridge_delivery_failures_total` | Failed deliveries | Rate > 10/min |
| `bridge_queue_depth` | Pending jobs | > 1000 |
| `bridge_http_requests_total` | Request volume | Error rate > 5% |

### Health Check Monitoring

```bash
# Simple health check script
curl -sf http://localhost:8080/health | jq -e '.status == "healthy"'
```

## Scaling Considerations

### Horizontal Scaling

The bridge can run multiple instances with shared database and Redis:

1. Use Redis for session/cache coordination
2. Configure shared inbox for ActivityPub delivery
3. Use a load balancer for the ActivityPub endpoints

### Vertical Scaling

For single-instance deployments:

| Users | RAM | CPU | Database |
|-------|-----|-----|----------|
| < 1,000 | 512MB | 1 core | 1GB |
| 1,000 - 10,000 | 2GB | 2 cores | 5GB |
| 10,000+ | 4GB+ | 4+ cores | 20GB+ |

## Troubleshooting

### Common Issues

#### Bridge not receiving Matrix events

1. Check appservice registration is loaded:
   ```bash
   curl http://localhost:8008/_synapse/admin/v1/server_notices/admin
   ```

2. Verify the appservice URL is reachable from Synapse:
   ```bash
   curl http://localhost:9000/_matrix/app/v1/ping
   ```

#### ActivityPub federation failing

1. Check WebFinger is accessible:
   ```bash
   curl "https://bridge.example.com/.well-known/webfinger?resource=acct:user@bridge.example.com"
   ```

2. Verify HTTP signatures:
   ```bash
   # Check logs for signature verification errors
   journalctl -u matrix-ap-bridge | grep -i signature
   ```

#### High memory usage

1. Check Redis memory:
   ```bash
   redis-cli INFO memory
   ```

2. Monitor queue depth:
   ```bash
   curl http://localhost:8080/metrics | grep queue_depth
   ```

### Log Levels

Set `LOG_LEVEL` environment variable:

- `error`: Only errors
- `warn`: Warnings and errors
- `info`: Normal operation (default)
- `debug`: Detailed debugging
- `trace`: Very verbose (not for production)

## Security Checklist

- [ ] TLS certificates are valid and auto-renewing
- [ ] Database credentials are not default
- [ ] Redis is not exposed to the internet
- [ ] Metrics endpoint is access-controlled
- [ ] Admin users are configured correctly
- [ ] Instance blocklist is configured if needed
- [ ] Firewall rules restrict access appropriately
- [ ] Logs do not contain sensitive data
