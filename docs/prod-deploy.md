# Wingman Tower Prod Deploy

## Required env

Tower runtime needs these values:

- `SUPERBASED_DIRECT_HTTPS_URL`
- `ADMIN_NPUB`
- `SUPERBASED_SERVICE_NSEC`
- `STORAGE_S3_ENDPOINT`
- `STORAGE_S3_ENDPOINT_PUBLIC`
- `STORAGE_S3_ACCESS_KEY`
- `STORAGE_S3_SECRET_KEY`
- `STORAGE_S3_BUCKET`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

If you use the provided Docker Compose stack, set these wrapper vars too:

- `TOWER_PORT`
- `TOWER_HOST_PORT`

If you run raw `docker run`, pass the app port as `PORT`.

Optional because Tower has code defaults:

- `STORAGE_S3_REGION` default `us-east-1`
- `STORAGE_S3_FORCE_PATH_STYLE` default `true`
- `STORAGE_PRESIGN_UPLOAD_TTL_SECONDS` default `900`
- `STORAGE_PRESIGN_DOWNLOAD_TTL_SECONDS` default `900`
- `DB_MAX_CONNECTIONS` default `10`
- `SUPERBASED_SERVICE_PUBKEY_HEX`
- `SUPERBASED_SERVICE_NPUB`
- `DB_WAIT_MAX_ATTEMPTS` default `40`

Important container note:

- `STORAGE_S3_ENDPOINT=http://127.0.0.1:9000` only works if Tower uses the host network.
- In the provided Docker Compose stack, use `http://host.docker.internal:9000` to reach MinIO running on the Docker host.

## First-time setup

1. Copy the env template:

```bash
cd /Users/mini/code/wingmanbefree/wingman-tower
cp .env.prod.example .env.prod
```

2. Edit `.env.prod`:

- set `SUPERBASED_DIRECT_HTTPS_URL` to the production Tower URL
- set `SUPERBASED_SERVICE_NSEC` to the stable service key
- set `DB_PASSWORD` to a real password
- confirm `STORAGE_S3_ENDPOINT`
- leave `TOWER_PORT=3100` unless you intentionally want the app listening on a different internal port
- set `TOWER_HOST_PORT` if you want to publish the container on a different host port

## Start prod stack

```bash
cd /Users/mini/code/wingmanbefree/wingman-tower
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

This starts:

- `wingman-tower-postgres`
- `wingman-tower-b3`

Postgres is created automatically and Tower waits for it, runs migrations, then starts the API.

## Health checks

```bash
curl http://127.0.0.1:${TOWER_HOST_PORT:-3100}/health
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f tower
```

## Admin web

Open:

- `https://<your-tower-domain>/table-viewer`

Use a browser Nostr extension logged in as `ADMIN_NPUB`, then click `Connect with Nostr`.

The page now supports:

- table inspection
- workspace listing
- connection-token generation for a selected workspace and app `npub`

## Generate a connection token

1. Open `/table-viewer`
2. Connect with your admin Nostr identity
3. Select the workspace
4. Enter the app `npub` you want to target, for example Flight Deck's app namespace
5. Click `Generate Token`

The generated token can be used directly with Yoke:

```bash
cd /Users/mini/code/wingmanbefree/wingman-yoke
node src/cli.js init --token "<connection_token>"
```

## Update deploy

```bash
cd /Users/mini/code/wingmanbefree/wingman-tower
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

## Stop stack

```bash
cd /Users/mini/code/wingmanbefree/wingman-tower
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```
