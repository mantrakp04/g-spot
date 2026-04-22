# syntax=docker/dockerfile:1.7
# Build context: monorepo root (see fly.toml "dockerfile = apps/gmail-relay/Dockerfile")

FROM oven/bun:1.3.10-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
COPY apps/gmail-relay/package.json apps/gmail-relay/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/relay-db/package.json packages/relay-db/package.json
RUN bun install --filter gmail-relay --filter '@g-spot/*' --frozen-lockfile

FROM deps AS build
COPY packages/config packages/config
COPY packages/db packages/db
COPY packages/env packages/env
COPY packages/relay-db packages/relay-db
COPY apps/gmail-relay apps/gmail-relay
WORKDIR /app/apps/gmail-relay
RUN bun build ./src/index.ts --outdir ./dist --target bun

FROM base AS runtime
ENV NODE_ENV=production RELAY_HOST=0.0.0.0 RELAY_PORT=8787
COPY --from=build /app/apps/gmail-relay/dist /app/dist
COPY --from=build /app/apps/gmail-relay/package.json /app/package.json
EXPOSE 8787
CMD ["bun", "run", "/app/dist/index.js"]
