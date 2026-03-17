# superbased-be

Planned home for the cleaned-up SuperBased backend and sync service that Coworker depends on.

See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the current build frame.

## Runtime Notes

For the current Wingman Be Free workflow:

- Tower is the service that runs in local Docker for development
- Tower can also be deployed separately to production on its own URL
- Flight Deck is not intended to run in Docker for local dev; it is run locally via Wingman/PM2 and deployed to CapRover for the latest live version
- Yoke is a local CLI and should ideally be consumable via `npx wingman-yoke` or `bunx wingman-yoke`

On this machine, Tower may be pointed at existing host Postgres and MinIO services from Docker rather than starting fresh copies inside the same stack.

## Production

Production deployment notes and the Docker Compose stack live in:

- `docs/prod-deploy.md`
- `.env.prod.example`
- `docker-compose.prod.yml`

Tower also exposes an admin web at `/table-viewer` for `ADMIN_NPUB` users. It can inspect tables and generate workspace connection tokens for Yoke/Agent Connect.
