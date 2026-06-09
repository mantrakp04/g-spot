export const meta = {
  name: "feature-port-analysis",
  description:
    "Mine a specific capability from a reference codebase and plan how to add it to ours. Scouts where the feature lives + decomposes it into facets, analyzes each facet (UX / implementation / hardening), maps our current state, then writes a PLAN.md.",
  phases: [{ title: "Scout" }, { title: "Analyze" }, { title: "Plan" }],
};

// ── Inputs via `args` (see SKILL.md). The only required ones are `feature`,
//    `sourceName`, and `sourcePath`; everything else has a usable fallback. ──
const cfg = args ?? {};
const FEATURE = cfg.feature ?? "the requested capability"; // free-form: "tab drag-reorder", "a command palette", "agent resume"
const SRC_NAME = cfg.sourceName ?? "source"; // e.g. "cmux", "zed"
const SRC_PATH = cfg.sourcePath ?? "/tmp/feature-port-src"; // cloned/located source repo
const SRC_DESC = cfg.sourceDescription ?? "a reference codebase";
const OURS_ROOT = cfg.oursRoot ?? "/Users/barreloflube/Desktop/g-spot";
const OURS_NAME = cfg.oursName ?? "g-spot";
const OURS_SEEDS = cfg.oursSeeds ?? "(no hints given — search the repo for where this feature would live)";
const SLUG = cfg.slug ?? "feature";
const OUT = cfg.outDir ?? `${OURS_ROOT}/docs/feature-port/${SLUG}`;
const PLAN_PATH = cfg.planPath ?? `${OUT}/PLAN.md`;
const MAX_FACETS = cfg.maxFacets ?? 4;

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["file", "findings", "keyTakeaways"],
  properties: {
    file: { type: "string", description: "absolute path of the MD file written" },
    findings: { type: "array", items: { type: "string" } },
    keyTakeaways: { type: "array", items: { type: "string" } },
  },
};

// ── Phase 1: Scout — find where the feature lives + break it into facets. ──
// Skipped if the caller passed `args.facets` explicitly.
phase("Scout");

let facets = cfg.facets;
if (!facets) {
  const FACET_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["whereItLives", "facets"],
    properties: {
      whereItLives: { type: "string", description: "short prose: which dirs/files/modules implement the feature" },
      facets: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "scope", "seeds"],
          properties: {
            title: { type: "string", description: "kebab-case facet name" },
            scope: { type: "string", description: "1-2 sentences on what this facet covers" },
            seeds: { type: "string", description: "grep hints / file globs to start from" },
          },
        },
      },
    },
  };
  const scout = await agent(
    `Explore **${SRC_NAME}** (${SRC_DESC}) at ${SRC_PATH} and locate where **"${FEATURE}"** is implemented. Use Glob/Grep/Read — follow the code, don't guess.

Decompose the feature into up to ${MAX_FACETS} coherent facets worth analyzing separately. Pick facets that fit THIS feature's domain — it may be UI, backend logic, a data model, infra/build tooling, a CLI, an algorithm, a protocol, etc. (e.g. data model / state, core logic or algorithm, I/O & integration points, persistence & sync, public API / contract, error & edge-case hardening). For each facet return { title (kebab-case), scope (1-2 sentences), seeds (grep hints or file globs to start from) }.

Return whereItLives (short prose naming the real dirs/files/modules) + the facets array.`,
    { label: `scout:${SRC_NAME}`, phase: "Scout", schema: FACET_SCHEMA },
  );
  facets = scout.facets ?? [];
  log(`"${FEATURE}" → ${facets.length} facets. Lives in: ${scout.whereItLives}`);
}
if (!facets || facets.length === 0) {
  facets = [{ title: SLUG, scope: FEATURE, seeds: "search the repo for the feature" }];
}

// ── Phase 2: Analyze — one doc per source facet + one doc on our current state. ──
phase("Analyze");

const srcPrompt = (f) => `You are analyzing **${SRC_NAME}** (${SRC_DESC}) at ${SRC_PATH}, focused on the feature **"${FEATURE}"** — specifically the facet **${f.title}**.

Scope: ${f.scope}
Seeds (expand via Glob/Grep — find ALL relevant files): ${f.seeds}

Read the relevant files thoroughly. Extract THREE things:
- **What it does (behavior / contract)**: inputs, outputs, observable behavior, states, edge cases. For UI features include the interaction model; for backend/CLI/lib features include the API/contract and invariants. Concrete.
- **How it's built**: architecture, key types/files/symbols, data flow, state ownership, persistence, concurrency, dependencies.
- **Hardening (battle-tested-over-time)**: defensive patterns, race/concurrency handling, edge cases explicitly coded for, retries/throttles/backoff, bounds & limits, validation, telemetry, comments referencing past bugs, lifecycle/teardown safety. This is the gold.

Write a markdown file to **${OUT}/${f.title}.md** (sections: Overview, Behavior, Implementation, Hardening & Lessons, Key Files). Cite real file/symbol names. Tag each thing as a portable concept vs a source-specific mechanic (language/runtime/platform/framework detail that won't carry over). Use the Write tool, then return the structured summary.`;

const oursPrompt = () => `You are analyzing **${OURS_NAME}** at ${OURS_ROOT} to see how it currently handles (or doesn't) the feature **"${FEATURE}"** — documented honestly, including what's missing/stubbed/naive.

Where to look: ${OURS_SEEDS}
Expand via Glob/Grep. Find the real files where this feature does or would live.

Extract: current behavior + state stores/persistence/shortcuts; implementation (key files/hooks, client↔server flow, schema); and the gaps vs the feature as it exists in ${SRC_NAME}. Note the exact insertion points where the ported feature would plug in.

Write to **${OUT}/ours.md** (sections: Current State, Implementation, Gaps, Insertion Points). Use the Write tool, then return the structured summary.`;

const analyses = (
  await parallel([
    ...facets.map((f) => () =>
      agent(srcPrompt(f), { label: `${SRC_NAME}:${f.title}`, phase: "Analyze", schema: SUMMARY_SCHEMA }),
    ),
    () => agent(oursPrompt(), { label: `ours:${SLUG}`, phase: "Analyze", schema: SUMMARY_SCHEMA }),
  ])
).filter(Boolean);
log(`Wrote ${analyses.length} analysis docs`);

// ── Phase 3: Plan — synthesize a concrete port plan. ──
phase("Plan");

const index = analyses
  .map((a) => `- ${a.file}\n  findings: ${(a.findings || []).join("; ")}\n  takeaways: ${(a.keyTakeaways || []).join("; ")}`)
  .join("\n");

const plan = await agent(
  `Synthesize a plan to add **"${FEATURE}"** (as ${SRC_NAME} implements it) to **${OURS_NAME}**, cleanly and scoped to our stack.

Source facet docs + our-state doc: ${OUT}/*.md
Index of findings:
${index}

Read ALL those MD files (Glob ${OUT}/*.md). Read current ${OURS_NAME} source where needed so proposals reference real files + fit the existing architecture. Respect the repo's constraints (local-first, not multi-tenant SaaS; simplicity over forcing the current arch; port concepts, not platform-specific mechanics).

Write **${PLAN_PATH}** with:
1. **How ${SRC_NAME} does it** — the essential model + the hardening worth keeping (tagged with source doc).
2. **How ${OURS_NAME} differs today** — current state + the exact insertion points.
3. **Port plan** — concrete scoped steps. Per step: problem, change, exact files to touch, effort (S/M/L), dependency order. Flag any step that touches a **stateful flow** (lifecycle / persistence / resume / auth / background work) as NEEDS-SIGN-OFF.
4. **Quick wins** — high-value low-effort first steps.
Do NOT write code — this is a plan. Use the Write tool, then return the structured summary (file = PLAN.md path; findings = section titles; keyTakeaways = the first steps to implement).`,
  { label: "plan", phase: "Plan", schema: SUMMARY_SCHEMA },
);

return { facets, analyses, plan };
