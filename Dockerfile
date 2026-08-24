# syntax=docker/dockerfile:1
#
# Two stages: build with the full Bun image, run on the slim one. Runtime keeps
# migrations/ and scripts/ (the readiness probe and the release command need them —
# see .dockerignore) and postgresql-client (migrate.sh drives psql).

# ---------------------------------------------------------------------------
# builder
# ---------------------------------------------------------------------------
FROM oven/bun:1.2.15 AS builder
WORKDIR /app

# Granular layers: dependencies change far less often than source.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json svelte.config.js vite.config.ts .npmrc bunfig.toml ./
COPY project.inlang ./project.inlang
COPY messages ./messages
COPY static ./static
COPY src ./src
# scripts/run-vite.sh is what `bun run build` (below) execs into — see its own header
# comment for why: Bun's automatic .env loading corrupts any `$`-bearing value (the
# argon2id WORKLOG_PASSPHRASE_HASH), so `build`/`dev`/`preview` route through a script
# that exports .env itself instead of letting Bun parse it. This build only ever uses
# the placeholder ENV values set below, never .env, but the script is what the "build"
# script in package.json now names, so it has to be present for `bun run build` to
# resolve at all.
COPY scripts ./scripts

# Placeholder values so build-time environment validation (core/config.ts) passes —
# none of these are ever served; the real ones come from Fly secrets/[env] at runtime.
# APP_ENV=production is pinned explicitly, here and not left to default: the
# Content-Security-Policy is chosen at build time from this variable
# (svelte.config.js), and an unset APP_ENV must never be able to bake the development
# policy (unsafe-inline/unsafe-eval) into a shipped image.
ENV APP_ENV=production \
	PUBLIC_ORIGIN=https://build-placeholder.invalid \
	DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder \
	WORKLOG_API_TOKEN=00000000000000000000000000000000 \
	WORKLOG_PASSPHRASE_HASH='$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
	TIMEZONE=Europe/Prague \
	DAY_START_HOUR=3 \
	GAUGE_START=06:00 \
	GAUGE_END=00:00 \
	EVENING_HOUR=21

RUN bunx svelte-kit sync && bun run build

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM oven/bun:1.2.15-slim AS runtime
WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends postgresql-client \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/build ./build
# Copied, never baked into a build-time list: the readiness probe (hooks.server.ts)
# compares migrations/*.sql against schema_migrations at request time, so a filename
# it cannot see is a migration it can never detect as missing.
COPY migrations ./migrations
COPY scripts ./scripts

RUN addgroup --system worklog \
	&& adduser --system --ingroup worklog --home /app worklog \
	&& chown -R worklog:worklog /app
USER worklog

# adapter-node enforces its OWN request-body ceiling (default 512K) before this app's
# handle chain — and therefore MAX_BODY_BYTES (core/config.ts, 1 MiB) — ever sees a
# byte of the stream; left at the default, every request between 512K and 1 MiB would
# be rejected by adapter-node's raw body reader instead of by this app's own
# Requirement-12.6 check, which is the one that answers PAYLOAD_TOO_LARGE in the
# standard envelope. Set comfortably above MAX_BODY_BYTES so this app's own check is
# always the one that fires.
ENV PORT=3000 \
	BODY_SIZE_LIMIT=2097152
EXPOSE 3000

CMD ["bun", "run", "build/index.js"]
