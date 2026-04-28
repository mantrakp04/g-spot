# Deployment

Operational notes for publishing the relay and desktop app artifacts.

## Relay

The relay app lives in `apps/relay` and deploys to Fly as `g-spot-relay`.

Public Fly URL:

```text
https://g-spot-relay.fly.dev
```

Runtime data is stored on the Fly volume:

```text
relay_data -> /data/relay.db
```

Required Fly runtime secrets:

```text
STACK_PROJECT_ID
STACK_SECRET_SERVER_KEY
GMAIL_PUBSUB_TOPIC_NAME
GMAIL_PUBSUB_VERIFICATION_TOKEN
```

Required GitHub Actions secret:

```text
FLY_API_TOKEN
```

The `Relay` workflow verifies type safety and relay DB migration
compatibility before deploying pushes to `main`.

### DNS

`relay.g-spot.dev` should point at Fly.

Preferred record:

```text
Type: CNAME
Name: relay
Target: g-spot-relay.fly.dev
Proxy: DNS only
TTL: Auto
```

Direct records if needed:

```text
Type: A
Name: relay
Value: 66.241.124.231
Proxy: DNS only
TTL: Auto
```

```text
Type: AAAA
Name: relay
Value: 2a09:8280:1::10a:6b32:0
Proxy: DNS only
TTL: Auto
```

After DNS is configured:

```bash
fly certs add relay.g-spot.dev -a g-spot-relay
```

## Relay DB Migrations

Relay state schema changes must remain backwards compatible. The current SQLite
state adapter records schema version with `PRAGMA user_version`.

Check migration compatibility locally:

```bash
bun run --filter @g-spot/chat-state-sqlite test:migrations
```

For zero-downtime changes, use expand/contract:

1. Add nullable columns, new tables, or new indexes first.
2. Deploy code that can read old and new shapes.
3. Backfill separately if needed.
4. Switch reads to the new shape.
5. Remove old paths in a later release.

Avoid destructive startup migrations.

## Desktop Releases

Desktop release workflow: `Desktop release`.

Release channels:

- Nightly: pushes to `main` publish artifacts only when
  `apps/desktop/package.json` changes and its `version` value is different from
  the previous revision.
- Stable: manual workflow dispatch publishes artifacts for the current
  `apps/desktop/package.json` version.

Nightly maps to Electrobun's `canary` build environment because Electrobun
supports `dev`, `canary`, and `stable`.

Local builds:

```bash
bun run build:desktop
bun run build:desktop:nightly
```

macOS desktop releases are code signed and notarized by Electrobun. Configure
these GitHub Actions secrets before publishing a macOS DMG:

```text
ELECTROBUN_DEVELOPER_ID
ELECTROBUN_TEAMID
ELECTROBUN_APPLEID
ELECTROBUN_APPLEIDPASS
```

If these are missing, the macOS release build should fail instead of publishing
an unsigned DMG that macOS Gatekeeper reports as damaged.

Electrobun outputs artifacts to:

```text
apps/desktop/artifacts/
```

The desktop app's version and release tag are derived from
`apps/desktop/package.json`. Electrobun reads the same version in
`apps/desktop/electrobun.config.ts`.

The workflow publishes each build twice:

- Version release: immutable release for the version you chose.
- Channel release: moving release used by the desktop updater.

## Stable Versioning

The source of truth for desktop release versions is
`apps/desktop/package.json`.

Stable tag shape:

```text
desktop-v<version>
```

Example:

```text
desktop-v0.1.0
```

Nightly tag shape:

```text
desktop-nightly-v<version>
```

Updater channel tags:

```text
desktop-stable
desktop-nightly
```

To cut a release, update `apps/desktop/package.json`:

```json
{
  "version": "0.1.0"
}
```

Then merge to `main` for nightly. Run the `Desktop release` workflow manually
with `channel=stable` for stable.

## Desktop Updates And Migrations

The desktop app runs local DB migrations before starting the bundled server.
The update button in the app asks the Electrobun updater to check the current
channel release, download the update, and apply it.

Installed apps read update metadata from the moving channel release configured
in `apps/desktop/electrobun.config.ts`, so keep publishing artifacts to
`desktop-stable` and `desktop-nightly` even though versioned releases are also
created.
