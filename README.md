# g-spot

> ⚠️ **Alpha.** Expect bugs, missing features, and breaking changes. Data
> formats and APIs are not yet stable.

A local-first desktop command center for email, code review, and an
approval-gated AI agent — all in one quiet window.

g-spot bundles a React app, local API, SQLite persistence, and an Electrobun
desktop shell into one machine-first workspace. Your data lives in a SQLite
file you can `cp`. The cloud piece is intentionally small: a Fly-hosted relay
for push notifications.

## Download

[**↓ Download the latest release**](https://github.com/mantrakp04/g-spot/releases/latest)

Stable and nightly builds are published as GitHub releases for macOS
(Apple Silicon), Linux (x64), and Windows (x64). The app auto-updates from
the channel it was installed on.

- Stable: [`desktop-stable`](https://github.com/mantrakp04/g-spot/releases/tag/desktop-stable)
- Nightly: [`desktop-nightly`](https://github.com/mantrakp04/g-spot/releases/tag/desktop-nightly)

<!-- Add product screenshots, demo videos, and launch images here. -->

## What It Does

### One inbox for mail and code
Gmail threads, GitHub pull requests, and GitHub issues live in a single
sectioned inbox. Sections are user-defined: pick a source, pick filters,
pick the columns you want, drag to reorder. Each section can show a badge
count.

### Gmail, fully wired
Read threads, compose new mail, reply / reply-all / forward, manage drafts,
apply labels, handle attachments. A floating **draft dock** lets you juggle
multiple drafts in parallel without losing your inbox view. **Inline compose**
keeps replies in the thread.

A separate `apps/relay` service receives Google Pub/Sub notifications
and pushes them over WebSocket to the desktop client for real-time sync.

### PR review at home
A full pull request review surface: syntax-highlighted diffs, inline comment
threads, CI checks, timelines, commit-stack visualization, and a quiet
keyboard-driven action bar. Issues are reviewable too.

### Agent chat with approval gates
Per-project AI chats with streaming, slash-skills, file attachments, model
picker, and queued steering messages. The distinctive bit: **tool calls are
gated by user approval.** The agent surfaces an approval card with the tool
name, parameters, and reason — you approve or deny with an optional message
back to the model.

Per-chat controls let you set the **sandbox** (read-only / workspace-write /
full-access), toggle **network access**, and whitelist which built-in tools
the agent can use.

### Memory that actually remembers
A local knowledge graph (entities + observations + relationships) backed by
sqlite-vec embeddings. Chat turns are auto-ingested. Salience and confidence
decay over time. The agent queries it as context, so "what did I tell you
last week" works.

### Projects and skills
Local **projects** scope chats, agent config, and custom instructions to a
working directory. **Skills** are reusable prompt bundles invoked as
`/slash-commands` — global or project-scoped (project shadows global).

### Desktop shell
Electrobun packages everything into a native macOS app. Auto-updates from
GitHub releases (stable / nightly channels). OAuth login uses an
external-browser-paste flow. Drizzle migrations run on startup.

## Stack

- **Runtime**: Bun, TypeScript, Turborepo
- **Web**: React 19, Vite, TanStack Router / Query / Table, Tailwind v4, shadcn
- **API**: Elysia, tRPC, Zod
- **Data**: Drizzle, SQLite, sqlite-vec
- **Desktop**: Electrobun
- **Agent**: [Pi SDK](https://github.com/badlogic/pi) (`pi-agent-core`, `pi-ai`, `pi-coding-agent`)
- **Auth**: Stack Auth (Gmail + GitHub OAuth)
- **Integrations**: Gmail API, Google Pub/Sub, GitHub via Octokit
- **Hosting**: Fly.io for the relay only

## Repo Map

```text
apps/
  desktop/      Electrobun desktop shell + auto-updater
  web/          React UI (inbox, chat, review, projects, settings)
  server/       Local Elysia/tRPC API (bundled into desktop)
  relay/        Fly-hosted Gmail Pub/Sub → WebSocket relay
  landing/      Landing page
packages/
  api/          tRPC routers, chat runtime, streaming, memory ingest
  db/           Drizzle schema, migrations, queries
  types/        Shared types and Zod schemas
  env/          Zod-validated env config
  ui/           shadcn-style React components
  config/       Shared TypeScript config
  chat-adapter-gmail/    Gmail Pub/Sub payload adapter
  chat-state-sqlite/     SQLite state adapter for the relay
```

## Development

Building from source, local workflow, and the task-completion bar (run
`bun check-types` before finalizing) live in
[CONTRIBUTING.md](./CONTRIBUTING.md).

Release pipeline, relay deployment, DNS, and migration policy live in
[DEPLOYMENT.md](./DEPLOYMENT.md).

## License

MIT.
