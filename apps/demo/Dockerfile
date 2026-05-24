FROM oven/bun:1.3.10 AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates sqlite3 libsqlite3-0 \
  && rm -rf /var/lib/apt/lists/*

FROM base AS install
COPY package.json bun.lock turbo.json tsconfig.json bunfig.toml ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile

FROM install AS build
ENV NODE_ENV=production
ENV DEMO_MODE=true
ENV VITE_DEMO_MODE=true
ENV VITE_SERVER_URL=/
RUN bun run --filter web build
RUN bun run --filter server build
RUN bun run db:seed-demo

FROM base AS runtime
ENV NODE_ENV=production
ENV DEMO_MODE=true
ENV VITE_DEMO_MODE=true
ENV VITE_SERVER_URL=/
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=3000
ENV G_SPOT_WEB_DIST_DIR=/app/apps/web/dist

COPY --from=install /app/package.json /app/bun.lock /app/turbo.json /app/tsconfig.json /app/bunfig.toml ./
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/apps ./apps
COPY --from=install /app/packages ./packages
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/packages/db/src/migrations ./apps/server/dist/migrations
COPY --from=build /app/apps/server/demo.db ./apps/server/demo.db

RUN chmod +x /app/apps/demo/entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/app/apps/demo/entrypoint.sh"]
