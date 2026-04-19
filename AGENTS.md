# AGENTS.md

`CLAUDE.md` is a symlink to this file.

## Task completion requirements

### Type checking

```
// MANDATORY RUN at the end
bun check-types
```

Always run `bun check-types` after code changes before finalizing. If it fails, re-run until it passes. Turbo runs `check-types` in each workspace that defines it.

- Root **`fmt`** / **`lint`** scripts are not wired yet; Turbo’s `lint` task currently runs nothing. When you add formatters or linters, extend the root `package.json` and this section so they are part of the same bar.
- There is **no test runner** in the repo yet. If you add Vitest (or similar), prefer **`bun run test`** over **`bun test`** so the script name is explicit.

## Communication style

**Be concise and direct. No fluff. Match the energy.**

User uses casual language ("bro", "dawg", "ugh"). Keep responses terse and actionable. When something breaks, diagnose fast, fix faster.

### Handling interruptions

When a new message arrives mid-task, **don't drop what you're doing by default.** Triage it:

1. **Additive context** (extra detail, clarification, "also do X") — absorb it into the current task and keep going.
2. **Correction / "wait, that's wrong"** — stop the current step, address the correction, then resume or adjust course.
3. **New unrelated task** — finish the current task first, then start the new one. Don't context-switch mid-implementation.
4. **Explicit hard stop** ("stop", "drop this", "do X instead") — respect it immediately and switch.
5. **Urgent/blocking** ("you're breaking X", "that file is wrong") — prioritize now, but come back and finish the original task if it still makes sense.

Rule of thumb: **stay on task unless told otherwise or the interrupt would make continued work harmful/wasteful.**

### Clarification gate (mandatory)

- Before implementing any non-trivial change, ask for confirmation if scope/intent is not explicitly specified.
- Do not assume architectural behavior for stateful flows (worker lifecycle, mode switching, persistence, auth propagation, background execution).
- If multiple reasonable implementations exist, present options briefly and wait for selection before coding.
- When a change can affect cross-context behavior (chat vs workflow, server vs client, trigger vs interactive path), ask first and get approval.
- Default to asking one targeted clarifying question rather than executing on inferred intent.

## Research grounding (web search)

**Treat the public web as the default source of truth for anything outside this repository.** Training data is not sufficient on its own for research, comparisons, or “how does X work today?”

- **Run web search** before you assert facts about third-party APIs, CLI behavior, framework versions, platform limits, security advisories, deprecations, licensing, or current events. Prefer primary sources (official docs, release notes, standards bodies) surfaced via search.
- **Ground questions to the user** in what search already showed. Prefer “I found [A] vs [B] in current docs; which matches your setup?” over guesses. If search is inconclusive, say that and point to what you checked.
- **Internal-only work** (reading this repo, inferring types, following existing patterns) does not require web search. **External claims and integration decisions do.**
- **Stack with other tools:** **Context7** for third-party SDK shapes and examples; **DeepWiki** (or repo docs) for a specific GitHub project’s behavior; **web search** for freshness, version matrices, and anything not covered by those. If two sources disagree, trust newer primary documentation after search, not memory.

## DO

- **Infer and derive types from existing packages** — avoid new types; use `Pick`, `Omit`, and built-in TS utilities.
- **Check existing patterns** in codebase before implementing.
- **Cross-check server/client impact** — if you edit server-side code, verify client usage, and vice versa.
- **Rename symbols to match reality** — if code moves across server/client boundaries, rename the original vars, schemas, imports, and helpers so the names describe what they actually are.
- **Use Context7 for third-party SDK API verification** before integrating.
- **For Convex deployment config (especially Vercel build commands), follow official Convex docs as source of truth.**
- **Verify against DeepWiki (or upstream repo docs) before asserting behavior of a specific open-source project; use web search for time-sensitive or general external facts** (see Research grounding above).
- **Keep responses terse** and actionable.
- **Use memo with custom comparison** for streaming optimization.
- **Use `useSyncExternalStore`** for shared mutable state.
- **Prefer Jotai atoms** for shared in-memory UI state instead of ad-hoc React context/provider wiring when possible.
- **Reference skills** when available (`emilkowal-animations`, `frontend-design`).
- **Use skeleton loaders**, not spinners.
- **Use GitHub CLI efficiently** — prefer `gh` subcommands over manual API calls, and reuse existing auth/config without re-authing.
- **Match Tailwind patterns exactly** — don't modify unrelated classes.
- **DRY the code** — reuse existing utilities.
- **Clean up after approach changes** — remove stale paths/helpers when method changes.
- **Split oversized modules** — break complex files into focused, manageable units.
- **Prefer workspace catalog dependencies** — add new deps to root `workspaces.catalog` and consume via `catalog:` when possible.
- **Ask clarifying questions** if requirements are unclear.

## DON'T

- Over-explain or pad responses.
- Create new abstractions when existing ones work.
- Touch Tailwind code that isn't directly relevant.
- Use virtualization unless absolutely necessary.
- Await non-critical operations (like title generation).
- Add "improvements" beyond what's requested.
- Leave copy-pasted names in place when the value moved and the name is now wrong.
- Paper over bad naming with aliases like `const client = server` or `export const foo = bar` when the real fix is to rename the symbol.
- Cast your own types — infer them.
- Use fallback/union types to paper over upstream data ambiguity. If an external API sends a number, accept a number and coerce it. Don't write `z.union([z.string(), z.number()])` — pick the canonical type and coerce with `z.coerce.*`. Hard-fail on genuinely wrong shapes; don't silently accept both.

---

## About this file

The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project.

If you ever encounter something in the project that surprises you, confuses you, or seems inconsistent, please alert the developer working with you instead of guessing or silently working around it. Note it here so future agents can avoid the same issue.

This project has no users. There's no real data yet. Make whatever changes you want and don't worry about data migration, backfills, or breaking existing users. We'll figure that out later when we actually ship.

## Deployment & runtime

- **Local-first, not cloud.** There is no production cloud deployment target for this repo. Do not prioritize multi-tenant SaaS patterns, edge hosting, or serverless cost/latency tradeoffs unless the task explicitly says so.
- **Optimize for a single machine** — fast startup, snappy UI, low friction on the developer/user’s box — not for regional redundancy, cold-start budgets, or platform billing quirks.
- **Ship shape: packaged desktop app.** The web UI and local API are built and **served together inside a desktop shell** (`apps/desktop`), not primarily as a public web URL. Default mental model: embedded local HTTP + bundled UI (this repo uses **Electrobun**; if packaging moves to Electron or similar, keep the same “local bundle” assumption).

## Client boundary

- **Treat `apps/web`, `apps/desktop`, and `apps/server` as client-facing surfaces.** They are user-reachable and must be handled with the same caution as frontend code for secrets exposure.
- **Only `apps/gmail-relay` is non-client-facing.** Keep sensitive-only logic and truly secret environment variables there unless they are strictly required elsewhere.
- **Do not reveal sensitive env vars to the client side.** Never expose secrets to browser code, desktop renderer code, preload-exposed APIs, or server responses intended for client consumption.
- **If an env var is sensitive, assume it must not be readable from `apps/web`, `apps/desktop`, or any client-consumable path in `apps/server`.** Pass derived data or server-side results instead of raw secrets.

## Project snapshot

**g-spot** is a TypeScript monorepo (Bun + Turborepo) built from [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack): React (Vite), TanStack Router, Elysia, tRPC, Drizzle, SQLite/Turso, and a desktop shell (`apps/desktop`).

The project may still be early. Proposing focused improvements that help long-term maintainability is welcome; avoid drive-by refactors unrelated to the task.

## Core priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (restarts, reconnects, partial responses).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long-term maintainability matters. When adding functionality, look for shared logic that belongs in a dedicated module. Duplicated logic across files is a smell—consolidate when it clarifies the design. Prefer changing existing code over piling on one-off local hacks.

## Package roles

- **`apps/server`**: Bun + **Elysia** + **tRPC** HTTP API; uses `@g-spot/api` routers and `@g-spot/db` for persistence. Treat as client-facing for data exposure and secret-handling decisions.
- **`apps/web`**: **React / Vite** SPA; **TanStack Router** (`src/routes/`); **tRPC** + TanStack Query client; shared UI from `@g-spot/ui` (Stack Auth and other app wiring live here). Client-facing.
- **`apps/desktop`**: **Electrobun** wraps the web build for a native shell (`dev:hmr` runs web dev + electrobun). Client-facing.
- **`apps/gmail-relay`**: Gmail relay service for non-client-facing push/webhook and secret-bearing relay work.
- **`packages/api`**: Shared **tRPC** router definitions and types consumed by server and web (`workspace:*`).
- **`packages/db`**: **Drizzle** schema, migrations, and DB scripts (`db:push`, `db:studio`, etc.).
- **`packages/ui`**: Shared **shadcn**-style components and global styles; import paths like `@g-spot/ui/...`.
- **`packages/env`**: **Zod**-validated environment variables shared across apps.
- **`packages/config`**: Shared **TypeScript** config consumed by packages and apps.
