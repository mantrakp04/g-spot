---
name: release-pkg
description: Use to cut a new release of the g-spot desktop app and/or CLI — bumps the `version` field in `apps/desktop/package.json` and `apps/cli/package.json`. Trigger whenever the user says "release new pkg", "release a new version", "bump version(s)", "cut a release", "ship a new build", "publish the CLI", "new desktop release", or types `/release`, even if they don't name the apps. Also use when they want to manually kick off the stable desktop release workflow.
version: "1.0.0"
---

# release-pkg

Cut a release by bumping the `version` field in the relevant `package.json` files. This skill **edits files only** — it does not commit, push, or publish. The user owns git; you own the version bump.

## Why editing is (almost) all you need

The release pipelines are wired to fire off the version in `package.json`:

- **Desktop** (`.github/workflows/desktop-release.yml`): a push to `main` that changes `apps/desktop/package.json` auto-builds and publishes a **nightly** release. A **stable** release only happens via manual dispatch.
- **CLI** (`.github/workflows/cli-npm-publish.yml`): a push to `main` touching `apps/cli/**` (or shared `packages/**`, `apps/web`, `apps/server`) reads `apps/cli/package.json` and publishes to npm — but **skips if that version already exists on npm**. So bumping the version is what actually ships a new CLI build.

This is why the bump is the whole job: once the user commits and pushes, the workflows do the rest. You only run a command yourself for a **stable** desktop release (see below).

## Default scope: both desktop + cli

Unless the user clearly means only one, bump **both** `apps/desktop/package.json` and `apps/cli/package.json` together.

## Versioning: semver

Both apps moved to standard semver (`MAJOR.MINOR.PATCH`). If you ever encounter a non-semver value still in a file (e.g. an old 4-part `0.0.7.8`), normalize it to a clean semver baseline of `1.0.0` and tell the user you did so.

Decide the new version like this:

1. Read the current `version` from each `package.json`.
2. **Patch** (`x.y.Z+1`) is the default for a routine release.
3. If the user says "minor" / "new feature" → bump **minor** (`x.Y+1.0`). If they say "major" / "breaking" → bump **major** (`X+1.0.0`).
4. If the user gives an exact version, use it verbatim.
5. The two apps version **independently** — don't force them to match. Bump each from its own current value.

Confirm the resulting versions back to the user (e.g. "desktop 1.0.0 → 1.0.1, cli 1.0.0 → 1.0.1") so a wrong bump is caught before they push.

## Doing the bump

Edit only the `version` line in each file — touch nothing else.

```jsonc
// apps/desktop/package.json
"version": "<new desktop version>",

// apps/cli/package.json
"version": "<new cli version>",
```

Then tell the user the bump is done and that **pushing to `main` will auto-release** (nightly desktop + CLI npm publish). Don't commit or push unless they explicitly ask.

## Stable desktop release (only when asked)

A push only ever produces a **nightly** desktop build. When — and only when — the user explicitly asks for a **stable** / production desktop release, dispatch the workflow:

```bash
gh workflow run desktop-release.yml -f channel=stable
```

Notes:
- This builds from the latest `main`, so make sure the version bump is already committed and pushed first — otherwise it ships the old version. If it isn't pushed yet, say so and let the user push before you dispatch.
- The CLI has no stable/nightly split; it just publishes the new version on push. There's nothing extra to trigger for the CLI.
- Confirm before dispatching — this kicks off a real signed/notarized build across macOS, Linux, and Windows.

## Quick checklist

1. Read current versions from both `package.json` files.
2. Determine new versions (patch default; honor minor/major/exact; normalize stray non-semver to `1.0.0`).
3. Confirm the old → new for each with the user.
4. Edit the `version` field(s) only.
5. Remind: push to `main` triggers nightly desktop + CLI npm publish.
6. Only if explicitly asked for stable: ensure the bump is pushed, then `gh workflow run desktop-release.yml -f channel=stable`.
