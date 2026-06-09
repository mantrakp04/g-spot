---
name: feature-port
description: Use to add a specific capability to our codebase by mining how another project does it. The capability can be ANY domain — UI, backend logic, data model, infra/build tooling, CLI behavior, an algorithm, a protocol, a perf or security technique. Trigger when the user says "add <feature> from <app/repo>", "port <X> from <Y>", "steal/borrow <X> from <repo>", "how does <app> do <X> — give us that", "I want <feature> like <app>", or types `/feature-port`. Scouts where the feature lives in the source, analyzes its behavior/implementation/hardening, maps our current state, writes a port plan, then implements it. Source can be any repo (URL or local path); feature is free-form.
version: "1.0.0"
---

# feature-port

Add capability **XYZ** from project **ABC**. A scout finds where XYZ lives in ABC and breaks it into facets; agents document each facet (behavior / implementation / hardening) and our current state; a final agent writes a port plan. You drive the gates and the implementation.

Output: `docs/feature-port/<slug>/<facet>.md`, `docs/feature-port/<slug>/ours.md`, `docs/feature-port/<slug>/PLAN.md`.

## Step 1 — Parse the request

Pull out the **feature** (free-form, any domain — "tab drag-reorder", "retry with exponential backoff", "a job queue", "structured logging", "rate limiting", "agent resume across restart", "a plugin loader") and the **source** (repo URL or local path). Pick a short kebab **slug** for the feature. If either is missing or ambiguous, ask one targeted question. Confirm whether to **implement** after planning or stop at the plan.

## Step 2 — Locate the source

Clone or locate the source repo: `git clone --depth 1 <url> /tmp/feature-port-src` (or use a path the user gives). Confirm it's the right project (read its README). Optionally jot where **ours** likely lives (file/dir hints) to focus the our-state analysis — the scout will search if you don't.

## Step 3 — Run the workflow

Invoke the Workflow tool with this skill's script and your `args`:

```
Workflow({
  scriptPath: ".agents/skills/feature-port/workflow.js",
  args: {
    feature: "retry with exponential backoff + jitter on transient failures",
    slug: "retry-backoff",
    sourceName: "some-lib",
    sourcePath: "/tmp/feature-port-src",
    sourceDescription: "a TypeScript HTTP client with mature retry handling",
    oursRoot: "/Users/barreloflube/Desktop/g-spot",
    oursName: "g-spot",
    oursSeeds: "packages/api/src/**, apps/server/src/**",  // optional hints (any layer)
    // facets: [ { title, scope, seeds }, ... ]   // optional — omit to auto-scout
    // maxFacets: 4
  }
})
```

The script **scouts** the source to find where the feature lives and splits it into domain-appropriate facets, **analyzes** each facet (Behavior / Implementation / **Hardening**) plus our current state + insertion points, then writes **PLAN.md** (how ABC does it → how we differ → concrete port steps with files/effort/order → quick wins). Runs in the background; you're notified on completion. Resume after edits with `{ scriptPath, resumeFromRunId }`.

## Step 4 — Review + present the plan

Read `PLAN.md`. Verify its claims about **our** code against real source before trusting them (analysis agents can be slightly off). Present the plan and ask which steps to implement and the order. Stop here if Step 1 said plan-only.

## Step 5 — Implement (follow CLAUDE.md)

- **Ground every claim** against real source before editing.
- **Gate stateful flows.** Any step flagged NEEDS-SIGN-OFF (worker lifecycle, resume/persistence, auth propagation, mode switching, background execution) → present options and get sign-off first (CLAUDE.md clarification gate). If deeper reading shows a requested change guards a non-existent failure mode, say so instead of building it.
- **Simplicity over the current arch** — put logic where it's cleanest (whichever layer/side); rename/remove stale paths when the method changes; keep it DRY (extract shared pure helpers).
- **Port concepts, not source-specific mechanics.** The *idea* and its hardening translate (bounded buffers, transactional updates with rollback, retries/backoff, structured-not-regex parsing, validation, defer-and-diff); the source's language/runtime/framework/platform glue does not. Adapt to our stack.
- **Finish:** run `bun check-types` until green, then **verify the way the feature's domain demands** — UI change → exercise it in a browser on port 3002 (dev server + the `browse` binary at `~/.claude/skills/gstack/browse/dist/browse`); server/lib/CLI change → run the path, hit the endpoint, or add/run a test; data/schema change → migrate + check a query. Don't commit unless asked.

## Extending / tuning

- **Control the breakdown:** pass `args.facets` explicitly to skip auto-scout, or bump `args.maxFacets`.
- **Whole-area sweep:** set `feature` to a broad area ("the whole auth flow", "the tabs/panes/workspaces UX") and let the scout fan it into facets — same engine, any domain.
- **Different source each time:** just change `sourceName` / `sourcePath` / `slug`; docs land under a fresh `docs/feature-port/<slug>/`.
- **Tune the engine:** edit `workflow.js` (scout/analysis/plan prompts, schema, phases) and re-invoke with the same `scriptPath`.
