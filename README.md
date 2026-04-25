# g-spot

A local-first desktop command center for email, code review, and agent-backed
workflows.

g-spot bundles a React app, local API, SQLite persistence, and an Electrobun
desktop shell into one machine-first workspace. The cloud piece is intentionally
small: a Fly-hosted Gmail relay for push notifications and webhook delivery.

<!-- Add product screenshots, demo videos, and launch images here. -->

## What It Does

- Unified inbox for Gmail, GitHub pull requests, and GitHub issues
- Custom sections and filters across connected work sources
- Gmail thread reading, composing, drafts, labels, and push sync
- Pull request review surfaces with diffs, timelines, checks, and inline notes
- Agent chat tied to local projects, branches, files, and memory
- Local SQLite storage for app state and fast desktop startup
- Packaged desktop app through Electrobun

## Why It Exists

Most work apps split communication, code review, project context, and AI into
separate surfaces. g-spot pulls those loops into one local workspace so the app
can stay close to your files, your branches, your inbox, and your decisions.

The default shape is not multi-tenant SaaS. It is a fast desktop app backed by a
local server, shared TypeScript packages, and a narrow relay service for the few
things that need to happen off-machine.

## Product Surfaces

### Desktop App

The main ship target. Electrobun packages the local API and web UI into a native
desktop shell.

### Inbox

Gmail, GitHub PRs, and GitHub issues can be organized into configurable sections
with source-specific filters and columns.

### Gmail

Gmail sync supports message/thread browsing, compose flows, drafts, labels, and
push-driven updates through the relay service.

### Code Review

Review views bring pull request metadata, commits, checks, diffs, timelines, and
inline review actions into the same workspace as chat and inbox state.

### Agent Workspace

Project-aware chat can use local files, git context, attachments, memory, and
permissions-aware tool execution.

## Stack

- Bun, TypeScript, Turborepo
- React, Vite, TanStack Router, Tailwind CSS
- Elysia, tRPC, Drizzle, SQLite
- Electrobun desktop shell
- Gmail API, Google Pub/Sub, GitHub integrations
- Fly.io for the Gmail relay

## Repo Map

```text
apps/
  desktop/      Electrobun desktop shell
  gmail-relay/  Fly-hosted Gmail push relay
  landing/      Landing page
  server/       Local Elysia/tRPC API
  web/          React/Vite UI
packages/
  api/          Shared routers and API logic
  chat-adapter-gmail/
  chat-state-sqlite/
  config/       Shared TypeScript config
  db/           Drizzle schema, queries, migrations
  env/          Zod env schemas
  types/        Shared domain types
  ui/           Shared UI components/styles
```

## Development

Contributor setup and local workflow live in [CONTRIBUTING.md](./CONTRIBUTING.md).

Deployment, relay DNS, database migration policy, and release pipeline details
live in [DEPLOYMENT.md](./DEPLOYMENT.md).
