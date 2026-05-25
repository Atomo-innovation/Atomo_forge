# Four separate MySQL databases (one per detection tab)

| Tab | Workspace id | Database |
|-----|----------------|----------|
| Person | `cameras` | `atomo_forge_person` |
| Fire & Smoke | `cameras2` | `atomo_forge_fire` |
| Face recognition | `cameras3` | `atomo_forge_face` |
| Safety | `cameras4` | `atomo_forge_safety` |

Each DB has table `detection_events` with `image_jpeg` (crop in MySQL).

## Setup

```bash
npm run mysql:tunnel          # keep running
npm run grant:events-db       # creates 4 DBs + grants on EC2
npm run migrate:events        # creates tables in all 4
npm run dev
```

## View in MySQL

```sql
SHOW DATABASES LIKE 'atomo_forge_%';
USE atomo_forge_person;
SELECT id, label, LENGTH(image_jpeg) FROM detection_events LIMIT 5;
```

Not MeshCentral. Old single DB `atomo_forge` is no longer used by the app.
