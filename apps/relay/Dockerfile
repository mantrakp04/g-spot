# syntax=docker/dockerfile:1.7
# Build context: monorepo root (see fly.toml "dockerfile = apps/relay/Dockerfile")

FROM oven/bun:1.3.10-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/relay/package.json apps/relay/package.json
COPY apps/landing/package.json apps/landing/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/chat-adapter-gmail/package.json packages/chat-adapter-gmail/package.json
COPY packages/chat-state-sqlite/package.json packages/chat-state-sqlite/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN bun install \
  --filter relay \
  --filter @g-spot/chat-adapter-gmail \
  --filter @g-spot/chat-state-sqlite \
  --filter @g-spot/env \
  --filter @g-spot/config \
  --frozen-lockfile

FROM deps AS build
COPY packages/chat-adapter-gmail packages/chat-adapter-gmail
COPY packages/chat-state-sqlite packages/chat-state-sqlite
COPY packages/config packages/config
COPY packages/env packages/env
COPY apps/relay apps/relay
WORKDIR /app/apps/relay
RUN bun build ./src/index.ts --outdir ./dist --target bun

FROM base AS runtime
ENV NODE_ENV=production RELAY_HOST=0.0.0.0 RELAY_PORT=8787
COPY --from=build /app/apps/relay/dist /app/dist
COPY --from=build /app/apps/relay/package.json /app/package.json
EXPOSE 8787
CMD ["bun", "run", "/app/dist/index.js"]
