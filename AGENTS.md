# AGENTS.md

`CLAUDE.md` is a symlink to this file.

## Task completion requirements

- **`bun check-types`** must pass before considering tasks complete (Turbo runs `check-types` in each workspace that defines it).
- Root **`fmt`** / **`lint`** scripts are not wired yet; Turbo’s `lint` task currently runs nothing. When you add formatters or linters, extend the root `package.json` and this section so they are part of the same bar.
- There is **no test runner** in the repo yet. If you add Vitest (or similar), prefer **`bun run test`** over **`bun test`** so the script name is explicit.

## Project snapshot

**g-spot** is a TypeScript monorepo (Bun + Turborepo) built from [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack): React (Vite), TanStack Router, Elysia, tRPC, Drizzle, SQLite/Turso, and an Electrobun desktop shell.

The project may still be early. Proposing focused improvements that help long-term maintainability is welcome; avoid drive-by refactors unrelated to the task.

## Core priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (restarts, reconnects, partial responses).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long-term maintainability matters. When adding functionality, look for shared logic that belongs in a dedicated module. Duplicated logic across files is a smell—consolidate when it clarifies the design. Prefer changing existing code over piling on one-off local hacks.

## Package roles

- **`apps/server`**: Bun + **Elysia** + **tRPC** HTTP API; uses `@g-spot/api` routers and `@g-spot/db` for persistence.
- **`apps/web`**: **React / Vite** SPA; **TanStack Router** (`src/routes/`); **tRPC** + TanStack Query client; shared UI from `@g-spot/ui` (Stack Auth and other app wiring live here).
- **`apps/desktop`**: **Electrobun** wraps the web build for a native shell (`dev:hmr` runs web dev + electrobun).
- **`packages/api`**: Shared **tRPC** router definitions and types consumed by server and web (`workspace:*`).
- **`packages/db`**: **Drizzle** schema, migrations, and DB scripts (`db:push`, `db:studio`, etc.).
- **`packages/ui`**: Shared **shadcn**-style components and global styles; import paths like `@g-spot/ui/...`.
- **`packages/env`**: **Zod**-validated environment variables shared across apps.
- **`packages/config`**: Shared **TypeScript** config consumed by packages and apps.

