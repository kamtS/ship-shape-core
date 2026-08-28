# Self-hosting Ship Shape

Ship Shape runs as one application container plus a private Redis session store. It can run in demo mode without GitHub credentials, or use a GitHub OAuth App for real repository access.

## Requirements

- Docker Engine and Docker Compose v2
- A domain with HTTPS when using GitHub OAuth in production
- A reverse proxy such as Caddy, Nginx, or Traefik
- A GitHub OAuth App if real Issue reads and writes are required

## Configure

Copy the production example and keep the completed file outside version control:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -base64 48
```

Set the generated value as `SESSION_SECRET`. Add your OAuth App client ID and client secret, then replace `ship-shape.example` with your own HTTPS domain in both URL values.

The OAuth App callback must be exactly:

```text
https://YOUR_DOMAIN/api/auth/github/callback
```

`public_repo` is the narrowest OAuth App scope that can create Issues in public repositories. Private repositories require the broader `repo` scope.

## Run

```bash
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build --pull
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps
```

The application binds to `127.0.0.1:8787` by default. Redis is reachable only on the private Compose network.

Use `deploy/Caddyfile.example` as the smallest Caddy site block. Keep TLS termination at the reverse proxy and do not rewrite `/api/auth/github/callback`.

## Verify

```bash
curl --fail --silent http://127.0.0.1:8787/healthz
curl --fail --silent http://127.0.0.1:8787/readyz
```

Then open the HTTPS site, sign in, select a writable repository, and complete a preview without confirming it. No Issue should exist. Confirm a new preview and verify exactly one Issue is created.

## Operational limits

This Compose setup is intentionally single-instance. Redis persists token-bearing sessions, so protect the host, volume, snapshots, and backups as secrets. Exact write previews are process-local and disappear on restart. Do not run multiple application replicas until previews use a shared atomic store.

The open-source core contains no hosted billing, tenancy, entitlement, customer-management, or vendor-specific production operations. A service operator should provide those concerns outside the core through independently maintained infrastructure and adapters.
