# Contributing

Keep changes focused, typed, and easy to verify.

## Local Setup

```bash
bun install
```

Use a root `.env` for local secrets and service configuration. Do not commit
secrets or local database files.

## Development

Useful commands:

```bash
bun run dev
bun run dev:web
bun run dev:server
bun run dev:desktop
```

Prefer existing workspace patterns before adding new abstractions. Keep shared
logic in packages when it is used across apps.

## Required Checks

Run before opening or updating a PR:

```bash
bun check-types
```

When touching relay state or migrations, also run:

```bash
bun run --filter @g-spot/chat-state-sqlite test:migrations
```

There is no repo-wide test runner yet.

## Database Changes

Main app database changes go through Drizzle:

```bash
bun run db:generate
bun run db:migrate
```

Relay DB changes must preserve existing queued/cache data. Use additive,
backwards-compatible migrations first. Avoid destructive startup migrations.

## Desktop Releases

Release versions come from `apps/desktop/package.json`.

Nightly releases are automatic from `main` only when the desktop package
`version` changes. Nightly tags use:

```text
desktop-nightly-v<version>
```

The workflow also updates moving channel releases for the in-app updater:

```text
desktop-stable
desktop-nightly
```

Stable releases are manual:

1. Open the `Desktop release` workflow in GitHub Actions.
2. Run workflow with `channel=stable`.
3. Confirm the `desktop-v<version>` release assets were created or updated.

Desktop DB migrations run before the desktop shell starts the local server.

Local builds:

```bash
bun run build:desktop
bun run build:desktop:nightly
```

## Relay Deployment

The relay deploys to Fly from `main` after type checks and migration compatibility
checks pass. Required GitHub secret:

```text
FLY_API_TOKEN
```

Runtime secrets live in Fly, not in the repo.

## Pull Request Checklist

- Scope is limited to the task.
- `bun check-types` passes.
- Relevant migration/build checks pass.
- Public/client-facing code does not expose secrets.
- README or contribution docs are updated when workflows or commands change.
