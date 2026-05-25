# atomo_forge — separate detection events database

This folder is **only** for the Forge detection-events database. It is **not** MeshCentral.

| Item | Value |
|------|--------|
| Database | `atomo_forge` (`MYSQL_EVENTS_DATABASE`) |
| Table | `detection_events` |
| Account column | `forge_account` (e.g. `board@local`) |
| Images | `image_jpeg` MEDIUMBLOB in MySQL |

## Setup (new database)

```bash
npm run mysql:tunnel          # terminal 1 — keep open
npm run setup:events-db       # terminal 2 — grant + tables + verify
npm run dev                   # or board:go
```

Manual steps:

1. On MySQL host (EC2): `scripts/sql/grant-atomo-forge.sql` (creates **atomo_forge**)
2. Laptop: `npm run mysql:tunnel` (keep running)
3. `npm run migrate:events`

## Do not

- Put detection rows in `meshcentral`
- Reuse `scripts/sql/007_atomo_detection_events.sql` (deprecated)
- Route events through the main auth `pool` — use `eventsPool` in `auth-server.cjs`
