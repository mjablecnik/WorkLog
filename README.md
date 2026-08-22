# Worklog

Records how a working day is actually spent, by reconciling two independent streams of data against each other.

During the day only a timer runs: press play when work starts, stop when it ends. Each play/stop pair becomes a **work session**, and everything between two sessions is a break — lunch, a snack, the end of the day. Nothing has to be typed while working.

Later — at the end of the day, or the next morning — activities are logged: what was worked on, and on which project. An activity can be given as an exact interval ("13:00–14:45 on project A") or as a bare duration ("two hours on project B"), in which case the server places it in the day automatically.

The two streams are reconciled at write time. An activity spanning a break is stored as several intervals with the break preserved between them, so a history read a week later shows when work actually happened rather than one unbroken block.

## Architecture

One SvelteKit application backed by PostgreSQL 16. The browser talks to it through load functions and form actions with an HttpOnly session cookie; scripts and phone shortcuts talk to the same data through REST routes under `/api` with a bearer token.

```
src/lib/server/domain/   pure reconciliation logic — no database, no HTTP
src/lib/server/store/    PostgreSQL access
src/routes/api/          REST endpoints for external callers
src/routes/              the interface
```

| Spec | Scope | Status |
|---|---|---|
| [`001-worklog-domain-api`](.kiro/specs/001-worklog-domain-api/) | domain, data layer, REST API | specified |
| [`002-worklog-ui`](.kiro/specs/002-worklog-ui/) | timer, day timeline, projects, statistics | in progress |

## How reconciliation works

Given a timer frame with a break from 14:48 to 15:12:

```
timer      ├──────────────────────────┤   ├─────────────────────────┤
           08:00                   14:48  15:12                 18:00

logged     "13:00–16:00, project A"

stored                       ├───────┤     ├──────┤
                          13:00   14:48  15:12  16:00
```

The entry keeps its original request (`13:00–16:00`) for auditing, while the stored segments follow the timer frame. In duration mode the same frame turns "two hours from 14:00" into `14:00–14:48` plus `15:12–16:24` — 48 minutes before the break and 72 after it, totalling exactly two hours of net work.

The server also reports which stretches of tracked time still have no activity logged against them, so the client can highlight what is left to describe.

## Documentation

- [`.kiro/specs/001-worklog-server-api/`](.kiro/specs/001-worklog-server-api/) — requirements, design and implementation plan for the server
- `worklog-server/README.md` — setup, configuration and deployment (written during implementation)
