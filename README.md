# Worklog

Records how a working day is actually spent, by reconciling two independent streams of data against each other.

During the day only a timer runs: press play when work starts, stop when it ends. Each play/stop pair becomes a **work session**, and everything between two sessions is a break. Nothing has to be typed while working.

Later — at the end of the day, or the next morning — activities are logged: what was worked on, and on which project. An activity can be given as an exact interval, as a bare duration ("two hours"), or as nothing but a project, in which case the server records everything since the last entry ended.

The two streams are reconciled at write time. An activity spanning a break is stored as several intervals with the break preserved between them, so a history read a week later shows when work actually happened rather than one unbroken block. Because the server can evaluate any write without performing it, the interface shows what a change will do before it is saved.

```
timer      ├──────────────────────────┤   ├─────────────────────────┤
           08:00                   14:48  15:12                 18:00

logged     "13:00–16:00, project A"

stored                       ├───────┤     ├──────┤
                          13:00   14:48  15:12  16:00
```

The entry keeps its original request for auditing, while the stored segments follow the timer frame.

## Prerequisites

- [Bun](https://bun.sh) 1.2.15 or newer
- PostgreSQL 16 with the `btree_gist` extension available
- [Docker](https://www.docker.com) for the local container workflow
- [flyctl](https://fly.io/docs/flyctl/) for deployment

## Installation

```bash
git clone <repository-url> worklog
cd worklog
bun install
cp .env.example .env
```

Fill in `.env` — at minimum `DATABASE_URL`, `WORKLOG_API_TOKEN` and `WORKLOG_PASSPHRASE_HASH`. Then apply the schema:

```bash
./scripts/migrate.sh
```

## Usage

```bash
bun run dev          # development server on http://localhost:5173
bun run check        # type and Svelte checks
bun run test         # unit, property and integration tests
bun run test:all     # everything, including end-to-end
bun run build        # production build
```

The browser signs in with the passphrase. Scripts and phone shortcuts use the bearer token against the same endpoints:

```bash
curl -X POST https://worklog.fly.dev/api/activities \
  -H "Authorization: Bearer $WORKLOG_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"…","description":"Reviewed the migration"}'
```

That records everything since the last entry ended — no times needed.

## Deployment

Local Docker:

```bash
./scripts/start-docker.sh     # build and run on port 3000
./scripts/stop-docker.sh
```

Fly.io:

```bash
cp .env.example .env.prod     # fill in production secrets
./scripts/deploy.sh prod      # or: dploy release prod
./scripts/deploy.sh stage     # any other environment
```

Useful commands:

```bash
fly logs --app worklog
fly status --app worklog
fly ssh console --app worklog
./scripts/backup.sh prod      # pg_dump into backups/
```

Migrations are forward-only: a mistake is corrected by a new migration, never by a rollback. Changing `TIMEZONE` or `DAY_START_HOUR` regroups existing history, so the server refuses to start on a mismatch unless `ALLOW_DAY_BOUNDARY_CHANGE` is set.

## Testing

```bash
bun run test           # unit + property + integration
bun run test:e2e:local # Playwright against an ephemeral database
bun run test:all       # the gate before pushing
```

Integration tests need PostgreSQL. `scripts/test-e2e.sh` starts one, migrates it, runs the suite and tears it down.

## Documentation

For more details see [DOCS.md](./DOCS.md).

Specifications live in `.kiro/specs/`:

| Spec | Scope |
|---|---|
| [`001-worklog-domain-api`](.kiro/specs/001-worklog-domain-api/) | domain, data layer, REST API |
| [`002-worklog-ui`](.kiro/specs/002-worklog-ui/) | timer, day timeline, projects, statistics |

## Author

👤 **Martin Jablečník**

- Email: martin.jablecnik@email.cz

## Show your support

Give a ⭐️ if this project helped you.

## License

Private project. All rights reserved.
