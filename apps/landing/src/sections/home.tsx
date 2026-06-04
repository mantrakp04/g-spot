import { Button } from "@g-spot/ui/components/button";
import { Card } from "@g-spot/ui/components/card";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Github,
  MonitorPlay,
  Terminal,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CopyCommand,
  DemoFrame,
  GhostLink,
  SmartDownload,
  useReducedMotion,
} from "../components/bits";
import {
  CLI_PACKAGE_URL,
  DEMO_URL,
  FEATURES,
  NIGHTLY_URL,
  REPO_URL,
  SOCKET_BADGE_URL,
  STACK,
} from "../lib/site";

const TITLE_TEXT = ` ██████╗       ███████╗██████╗  ██████╗ ████████╗
██╔════╝       ██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝
██║  ███╗█████╗███████╗██████╔╝██║   ██║   ██║
██║   ██║╚════╝╚════██║██╔═══╝ ██║   ██║   ██║
╚██████╔╝      ███████║██║     ╚██████╔╝   ██║
 ╚═════╝       ╚══════╝╚═╝      ╚═════╝    ╚═╝`;

type EngineLane = {
  label: string;
  detail: string;
};

type EngineFlowStep = {
  from: number;
  to: number;
  lane: number;
  title: string;
  state: string;
  detail: string;
};

type EnginePanel = {
  id: string;
  title: string;
  eyebrow: string;
  body: string;
  lanes: [EngineLane, EngineLane, EngineLane, EngineLane];
  facts: [string, string, string];
  flow: EngineFlowStep[];
};

type EnginePeekSide = "prev" | "next";
type EngineSwitchDirection = -1 | 1;
type EngineSelection = {
  index: number;
  direction: EngineSwitchDirection;
};

const ENGINE_PANELS: EnginePanel[] = [
  {
    id: "gmail-sync",
    title: "Gmail sync engine",
    eyebrow: "Push signal -> local state",
    body:
      "Gmail sends history signals through the relay. The local server drains them, fetches scoped deltas, commits checkpoints, then queues extraction.",
    lanes: [
      { label: "gmail", detail: "provider" },
      { label: "relay", detail: "public edge" },
      { label: "local gui", detail: "browser" },
      { label: "local server", detail: "127.0.0.1" },
    ],
    facts: ["Pub/Sub only carries cursors", "SQLite owns local state", "Extraction runs after sync"],
    flow: [
      { from: 2, to: 3, lane: 2, title: "heartbeat", state: "5m", detail: "UI auth ping" },
      { from: 3, to: 0, lane: 3, title: "renew watch", state: "watch", detail: "refresh Pub/Sub" },
      { from: 0, to: 1, lane: 0, title: "Pub/Sub push", state: "push", detail: "historyId" },
      { from: 1, to: 1, lane: 1, title: "queue event", state: "dedupe", detail: "verify + enqueue" },
      { from: 1, to: 3, lane: 1, title: "gmail.push", state: "drain", detail: "WebSocket event" },
      { from: 3, to: 0, lane: 3, title: "fetch delta", state: "fetch", detail: "changed threads" },
      { from: 3, to: 3, lane: 3, title: "checkpoint", state: "commit", detail: "history cursor" },
    ],
  },
  {
    id: "relay-delivery",
    title: "Relay delivery engine",
    eyebrow: "Webhook -> queue -> inflight -> DB",
    body:
      "The relay is a tiny durable bridge: it verifies Gmail Pub/Sub, stores QueueEntry payloads by email or user, sends one inflight event over WebSocket, and only clears it after the local server persists and schedules sync.",
    lanes: [
      { label: "gmail webhook", detail: "Pub/Sub POST" },
      { label: "relay queue", detail: "QueueEntry" },
      { label: "local server", detail: "WebSocket client" },
      { label: "local DB", detail: "SQLite account row" },
    ],
    facts: ["Queues are relay:email/* and relay:user/*", "inflight:* survives reconnects", "Ack waits for DB write + sync schedule"],
    flow: [
      { from: 0, to: 1, lane: 0, title: "verify push", state: "token", detail: "decode Pub/Sub" },
      { from: 1, to: 1, lane: 1, title: "dedupe", state: "5m", detail: "messageId key" },
      { from: 1, to: 1, lane: 1, title: "enqueue", state: "24h", detail: "pending QueueEntry" },
      { from: 1, to: 1, lane: 1, title: "claim", state: "inflight", detail: "10m user slot" },
      { from: 1, to: 2, lane: 1, title: "gmail.push", state: "ws", detail: "event payload" },
      { from: 2, to: 3, lane: 2, title: "record push", state: "atomic", detail: "lastNotificationHistoryId" },
      { from: 3, to: 2, lane: 3, title: "pending account", state: "newer", detail: "history gate" },
      { from: 2, to: 2, lane: 2, title: "startSync", state: "push", detail: "incremental plan" },
      { from: 2, to: 1, lane: 2, title: "ack", state: "clear", detail: "delete inflight" },
    ],
  },
  {
    id: "gmail-mutations",
    title: "Gmail mutation engine",
    eyebrow: "Drafts, sends, labels",
    body:
      "Composer actions call Gmail from the renderer. Background workflow tools use server Gmail wrappers, and sync reconciles durable local state.",
    lanes: [
      { label: "composer", detail: "user intent" },
      { label: "local gui", detail: "optimistic state" },
      { label: "workflow tools", detail: "server API" },
      { label: "gmail", detail: "provider truth" },
    ],
    facts: ["UI compose calls Gmail directly", "Workflow tools prefer drafts", "Labels use provider ids"],
    flow: [
      { from: 0, to: 1, lane: 0, title: "edit", state: "draft", detail: "compose body" },
      { from: 1, to: 3, lane: 1, title: "autosave", state: "debounce", detail: "client Gmail API" },
      { from: 1, to: 3, lane: 1, title: "send", state: "raw MIME", detail: "drafts/send" },
      { from: 2, to: 3, lane: 2, title: "workflow draft", state: "tools", detail: "server Gmail API" },
      { from: 2, to: 3, lane: 2, title: "modify labels", state: "ids", detail: "agent action" },
      { from: 3, to: 1, lane: 3, title: "provider result", state: "ack", detail: "draft/message id" },
      { from: 1, to: 1, lane: 1, title: "refresh cache", state: "query", detail: "thread invalidation" },
    ],
  },
  {
    id: "memory-engine",
    title: "Memory engine",
    eyebrow: "Local graph + vector search",
    body:
      "Memory stays on the machine: entities, observations, edges, scratchpads, embeddings, and graph traversal all resolve through the local server and SQLite vector tables.",
    lanes: [
      { label: "agent", detail: "tool calls" },
      { label: "memory api", detail: "tRPC router" },
      { label: "embedding", detail: "local model" },
      { label: "sqlite graph", detail: "local DB" },
    ],
    facts: ["Hybrid vector + graph search", "Editable observations", "Audit log per mutation"],
    flow: [
      { from: 0, to: 1, lane: 0, title: "memory_search", state: "query", detail: "agent asks" },
      { from: 1, to: 2, lane: 1, title: "embed", state: "vector", detail: "local tensor" },
      { from: 2, to: 3, lane: 2, title: "match", state: "topK", detail: "vec tables" },
      { from: 3, to: 3, lane: 3, title: "traverse", state: "BFS", detail: "graph context" },
      { from: 3, to: 1, lane: 3, title: "rank", state: "hybrid", detail: "salience bump" },
      { from: 1, to: 0, lane: 1, title: "context", state: "facts", detail: "tool result" },
    ],
  },
  {
    id: "memory-extraction",
    title: "Memory extraction workflow",
    eyebrow: "Threads and turns -> durable facts",
    body:
      "After chat turns or synced Gmail threads, a background extractor gives the agent memory tools and lets it merge entities, observations, and edges into the graph.",
    lanes: [
      { label: "source", detail: "chat / gmail" },
      { label: "extractor", detail: "worker session" },
      { label: "memory tools", detail: "guarded writes" },
      { label: "sqlite graph", detail: "durable memory" },
    ],
    facts: ["Fire-and-forget after chat", "Post-sync Gmail extraction", "Dedup before write"],
    flow: [
      { from: 0, to: 1, lane: 0, title: "eligible content", state: "scope", detail: "thread or turn" },
      { from: 1, to: 2, lane: 1, title: "search first", state: "dedupe", detail: "avoid repeats" },
      { from: 2, to: 3, lane: 2, title: "add entity", state: "hash", detail: "merge or create" },
      { from: 2, to: 3, lane: 2, title: "add observation", state: "fact", detail: "linked memory" },
      { from: 2, to: 3, lane: 2, title: "add edge", state: "relation", detail: "reinforce graph" },
      { from: 3, to: 3, lane: 3, title: "audit", state: "log", detail: "mutation trail" },
    ],
  },
  {
    id: "github-review",
    title: "GitHub review engine",
    eyebrow: "PR data -> rendered diff",
    body:
      "GitHub detail hooks fetch PR metadata, threads, files, and patches; the review surface keeps interaction state local and renders large diffs through the simplified viewer path.",
    lanes: [
      { label: "github", detail: "REST / GraphQL" },
      { label: "query cache", detail: "TanStack" },
      { label: "review shell", detail: "route state" },
      { label: "diff renderer", detail: "local UI" },
    ],
    facts: ["Metadata and review threads fetch separately", "Diff preferences stay client-side", "Large PRs avoid heavy rendering"],
    flow: [
      { from: 2, to: 1, lane: 2, title: "open PR", state: "target", detail: "owner/repo/number" },
      { from: 1, to: 0, lane: 1, title: "fetch detail", state: "REST", detail: "PR + files" },
      { from: 1, to: 0, lane: 1, title: "fetch threads", state: "GraphQL", detail: "comments" },
      { from: 0, to: 1, lane: 0, title: "normalize", state: "cache", detail: "query data" },
      { from: 1, to: 2, lane: 1, title: "compose view", state: "shell", detail: "sidebar + header" },
      { from: 2, to: 3, lane: 2, title: "render diff", state: "patch", detail: "collapsed files" },
    ],
  },
  {
    id: "gmail-label-workflow",
    title: "Gmail label workflow",
    eyebrow: "Extract, choose, mutate",
    body:
      "Labels are synced as a catalog, exposed to inbox builders and workflow tools, then applied back to Gmail by id while local thread rows reconcile through history.",
    lanes: [
      { label: "gmail", detail: "label catalog" },
      { label: "sync", detail: "history scan" },
      { label: "workflow agent", detail: "rules + tools" },
      { label: "local inbox", detail: "tables" },
    ],
    facts: ["Catalog powers filters", "History tracks label deltas", "Tooling mutates ids, not names"],
    flow: [
      { from: 0, to: 1, lane: 0, title: "list labels", state: "catalog", detail: "ids + colors" },
      { from: 1, to: 3, lane: 1, title: "store catalog", state: "SQLite", detail: "filter options" },
      { from: 3, to: 2, lane: 3, title: "workflow scope", state: "thread ids", detail: "incoming mail" },
      { from: 2, to: 3, lane: 2, title: "inspect thread", state: "local", detail: "body + labels" },
      { from: 2, to: 0, lane: 2, title: "modify labels", state: "ids", detail: "add/remove" },
      { from: 0, to: 1, lane: 0, title: "history delta", state: "labels", detail: "added/removed" },
    ],
  },
];

const ENGINE_SWITCH_VARIANTS = {
  enter: (direction: EngineSwitchDirection) => ({
    opacity: 0,
    x: direction > 0 ? 78 : -78,
    scale: 0.975,
    filter: "blur(6px)",
  }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
    filter: "blur(0px)",
  },
  exit: (direction: EngineSwitchDirection) => ({
    opacity: 0,
    x: direction > 0 ? -78 : 78,
    scale: 0.975,
    filter: "blur(6px)",
  }),
};

function laneCenter(lane: number) {
  return `${lane * 25 + 12.5}%`;
}

function routeStyle(from: number, to: number) {
  if (from === to) {
    const center = from * 25 + 12.5;
    return {
      left: `calc(${center}% - 1.8rem)`,
      right: `calc(${100 - center}% - 1.8rem)`,
    };
  }

  const start = Math.min(from, to) * 25 + 12.5;
  const end = Math.max(from, to) * 25 + 12.5;
  return {
    left: `calc(${start}% + 0.8rem)`,
    right: `calc(${100 - end}% - 0.8rem)`,
  };
}

function routeStateStyle(from: number, to: number) {
  if (from === to || Math.abs(from - to) > 1) {
    return { left: "50%" };
  }

  return { left: from < to ? "78%" : "22%" };
}

function wrapEngineIndex(index: number) {
  return (index + ENGINE_PANELS.length) % ENGINE_PANELS.length;
}

function engineSwitchDirection(
  current: number,
  target: number,
): EngineSwitchDirection {
  const forward = wrapEngineIndex(target - current);
  const backward = wrapEngineIndex(current - target);
  return forward <= backward ? 1 : -1;
}

const HERO_WORDS = ["mail", "code", "notes", "memory"] as const;

export function Home() {
  return (
    <>
      <Hero />
      <section className="mt-6 grid gap-5 sm:mt-8 sm:gap-6">
        <DemoBlock />
        <FeaturesBlock />
        <EngineBlock />
        <DownloadBlock />
        <CliBlock />
        <StackBlock />
        <CTA />
      </section>
    </>
  );
}

function Hero() {
  return (
    <section id="top" className="pt-4">
      <pre className="m-0 hidden w-fit overflow-x-auto font-mono text-xs/5 text-muted-foreground sm:block">
        {TITLE_TEXT}
      </pre>
      <div className="font-mono text-4xl font-semibold tracking-normal sm:hidden">
        g-spot
      </div>
      <div className="mt-5 grid gap-4 sm:mt-6">
        <h1 className="text-[1.7rem] font-medium leading-tight tracking-tight sm:text-2xl">
          Your <RotatingHeroWord /> in one place.
        </h1>
        <p className="text-sm/6 text-muted-foreground">
          g-spot is a local-first desktop app that bundles Gmail, GitHub PRs,
          notes, an approval-gated coding agent, and a local memory graph into
          one quiet window. It runs on your machine. It ships as a single
          install.
        </p>
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
          <SmartDownload className="w-full sm:w-auto" />
          <GhostLink href={DEMO_URL} className="w-full justify-center sm:w-auto">
            <MonitorPlay className="size-4" />
            Live demo
            <ArrowUpRight className="size-4" />
          </GhostLink>
          <GhostLink href={REPO_URL} className="w-full justify-center sm:w-auto">
            <Github className="size-4" />
            Star on GitHub
            <ArrowUpRight className="size-4" />
          </GhostLink>
        </div>
        <div className="grid gap-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span>or use the cli</span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
          <div className="grid gap-2 sm:max-w-[24rem]">
            <CopyCommand
              command="bunx g-spot-cli"
              className="rounded-md py-1.5 pl-3 pr-1.5"
              trailing={<PackageSafetyBadge />}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function PackageSafetyBadge({ className = "" }: { className?: string }) {
  return (
    <a
      href={CLI_PACKAGE_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="View g-spot-cli package on npm"
      className={`inline-flex h-5 w-fit items-center ${className}`}
    >
      <img
        src={SOCKET_BADGE_URL}
        alt="Socket package score"
        className="h-5 w-auto shrink-0"
      />
    </a>
  );
}

function RotatingHeroWord() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % HERO_WORDS.length);
    }, 1700);

    return () => window.clearInterval(timer);
  }, [reduced]);

  const word = HERO_WORDS[index];

  return (
    <span className="lp-hero-word" aria-live="polite">
      <span key={word} className="lp-hero-word__item" data-word={word}>
        {word}
      </span>
    </span>
  );
}

function DemoBlock() {
  return (
    <section id="demo" className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-muted-foreground">Demo</h2>
      </div>
      <DemoFrame />
    </section>
  );
}

function FeaturesBlock() {
  const reduced = useReducedMotion();
  const [activeFeature, setActiveFeature] = useState(0);

  return (
    <section id="features" className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Features</h2>
      <Card className="lp-feature-list overflow-hidden p-0">
        <ol>
          {FEATURES.map((feature, index) => (
            <motion.li
              key={feature.title}
              className="lp-feature-row"
              data-active={activeFeature === index}
              initial={
                reduced ? false : { opacity: 0, y: 10, filter: "blur(4px)" }
              }
              whileInView={
                reduced ? undefined : { opacity: 1, y: 0, filter: "blur(0px)" }
              }
              viewport={{ once: true, margin: "-80px" }}
              transition={{
                delay: reduced ? 0 : index * 0.045,
                duration: 0.28,
                ease: [0.16, 1, 0.3, 1],
              }}
              onMouseEnter={() => setActiveFeature(index)}
              onFocus={() => setActiveFeature(index)}
            >
              <span className="lp-feature-row__index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-medium">{feature.title}</h3>
                <p className="mt-1 text-xs/relaxed text-muted-foreground">
                  {feature.body}
                </p>
              </div>
            </motion.li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

function EngineBlock() {
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const sequenceRef = useRef<HTMLDivElement>(null);
  const hasShownPeekIntroRef = useRef(false);
  const switchTimeoutRef = useRef(0);
  const [engineSelection, setEngineSelection] = useState<EngineSelection>({
    index: 0,
    direction: 1,
  });
  const [autoRotateEngine, setAutoRotateEngine] = useState(true);
  const [engineSwitching, setEngineSwitching] = useState(false);
  const [engineHovering, setEngineHovering] = useState(false);
  const [hoveredPeek, setHoveredPeek] = useState<EnginePeekSide | null>(null);
  const [peekIntroActive, setPeekIntroActive] = useState(false);
  const [fixedLanes, setFixedLanes] = useState({
    active: false,
    left: 0,
    width: 0,
  });
  const activeEngine = engineSelection.index;
  const engineDirection = engineSelection.direction;
  const engine = ENGINE_PANELS[activeEngine];
  const previousEngineIndex = wrapEngineIndex(activeEngine - 1);
  const nextEngineIndex = wrapEngineIndex(activeEngine + 1);
  const isPeeking = engineHovering || peekIntroActive || engineSwitching;

  const startEngineSwitch = useCallback((_direction: EngineSwitchDirection) => {
    if (reduced) return;
    setEngineSwitching(true);
    if (switchTimeoutRef.current) {
      window.clearTimeout(switchTimeoutRef.current);
    }
    switchTimeoutRef.current = window.setTimeout(() => {
      setEngineSwitching(false);
      switchTimeoutRef.current = 0;
    }, 460);
  }, [reduced]);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const diagram = sequenceRef.current;
      const lanes = diagram?.querySelector(".lp-sequence-lanes");
      if (!diagram || !lanes) {
        setFixedLanes((current) =>
          current.active ? { active: false, left: 0, width: 0 } : current,
        );
        return;
      }

      const diagramRect = diagram.getBoundingClientRect();
      const laneHeight = lanes.getBoundingClientRect().height;
      const next = {
        active: diagramRect.top <= 0 && diagramRect.bottom > laneHeight,
        left: diagramRect.left,
        width: diagramRect.width,
      };

      setFixedLanes((current) =>
        current.active === next.active &&
        Math.round(current.left) === Math.round(next.left) &&
        Math.round(current.width) === Math.round(next.width)
          ? current
          : next,
      );
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [activeEngine]);

  useEffect(() => {
    if (reduced || !autoRotateEngine) return;
    const timer = window.setInterval(() => {
      startEngineSwitch(1);
      setEngineSelection((current) => ({
        index: (current.index + 1) % ENGINE_PANELS.length,
        direction: 1,
      }));
    }, 6200);

    return () => window.clearInterval(timer);
  }, [autoRotateEngine, reduced, startEngineSwitch]);

  useEffect(
    () => () => {
      if (switchTimeoutRef.current) {
        window.clearTimeout(switchTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (reduced || hasShownPeekIntroRef.current) return;
    const section = sectionRef.current;
    if (!section) return;

    let timeout = 0;
    let frame = 0;
    let observer: IntersectionObserver | null = null;

    const stopWatching = () => {
      observer?.disconnect();
      window.removeEventListener("scroll", scheduleFallback);
      window.removeEventListener("resize", scheduleFallback);
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const showPeekIntro = () => {
      if (hasShownPeekIntroRef.current) return;
      hasShownPeekIntroRef.current = true;
      setPeekIntroActive(true);
      timeout = window.setTimeout(() => setPeekIntroActive(false), 350);
      stopWatching();
    };

    const isSectionInFrame = () => {
      const rect = section.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.78 && rect.bottom > window.innerHeight * 0.22;
    };

    function scheduleFallback() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (isSectionInFrame()) showPeekIntro();
      });
    }

    if (typeof IntersectionObserver === "undefined") {
      scheduleFallback();
      window.addEventListener("scroll", scheduleFallback, { passive: true });
      window.addEventListener("resize", scheduleFallback);
      return () => {
        stopWatching();
        if (timeout) window.clearTimeout(timeout);
      };
    }

    observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        showPeekIntro();
      },
      { threshold: 0.38 },
    );

    observer.observe(section);
    return () => {
      stopWatching();
      if (timeout) window.clearTimeout(timeout);
    };
  }, [reduced]);

  const renderLanes = () =>
    engine.lanes.map((lane) => (
      <span
        key={lane.label}
        className="lp-sequence-lane"
      >
        <span className="lp-sequence-lane__dot" />
        <span className="lp-sequence-lane__copy">
          <strong>{lane.label}</strong>
          <small>{lane.detail}</small>
        </span>
      </span>
    ));

  const goToEngine = (index: number, direction?: EngineSwitchDirection) => {
    setAutoRotateEngine(false);
    const wrappedIndex = wrapEngineIndex(index);
    if (wrappedIndex === activeEngine) return;
    const nextDirection =
      direction ?? engineSwitchDirection(activeEngine, wrappedIndex);
    startEngineSwitch(nextDirection);
    setEngineSelection({ index: wrappedIndex, direction: nextDirection });
  };

  return (
    <section
      id="engine"
      ref={sectionRef}
      className="lp-engine-section min-w-0 space-y-3"
      data-peeking={isPeeking}
      data-peek-side={hoveredPeek ?? "none"}
      data-switching={engineSwitching}
      data-switch-direction={engineDirection > 0 ? "next" : "prev"}
      onMouseEnter={() => setEngineHovering(true)}
      onMouseLeave={() => {
        setEngineHovering(false);
        setHoveredPeek(null);
      }}
    >
      <div className="lp-engine-header">
        <h2 className="text-sm font-medium text-muted-foreground">Engines</h2>
        <div className="lp-engine-controls">
          <div
            className="lp-engine-tabs"
            role="tablist"
            aria-label="Engine carousel"
          >
            {ENGINE_PANELS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-label={`Show ${item.title}`}
                aria-selected={activeEngine === index}
                className="lp-engine-tab"
                onClick={() => goToEngine(index)}
              >
                {String(index + 1).padStart(2, "0")}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Previous engine"
            onClick={() => goToEngine(activeEngine - 1, -1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Next engine"
            onClick={() => goToEngine(activeEngine + 1, 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="lp-engine-carousel">
        <EnginePeek
          side="prev"
          engine={ENGINE_PANELS[previousEngineIndex]}
          index={previousEngineIndex}
          isPeeking={isPeeking}
          muted={hoveredPeek === "next"}
          onClick={() => goToEngine(previousEngineIndex, -1)}
          onMouseEnter={() => setHoveredPeek("prev")}
          onMouseLeave={() => setHoveredPeek(null)}
        />
        <div className="lp-engine-card-stage">
        <AnimatePresence custom={engineDirection} initial={false}>
          <motion.div
            key={engine.id}
            className="lp-engine-card-shell"
            custom={engineDirection}
            variants={ENGINE_SWITCH_VARIANTS}
            initial={reduced ? false : "enter"}
            animate={reduced ? undefined : "center"}
            exit={reduced ? undefined : "exit"}
            transition={{
              duration: 0.38,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <Card className="lp-engine-card min-w-0 p-0">
              <div className="border-b p-4 sm:p-5">
                <motion.div
                  key={`${engine.id}-copy`}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={reduced ? undefined : { opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                  className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]"
                >
                  <div>
                    <div className="font-mono text-[0.62rem] uppercase text-muted-foreground">
                      {engine.eyebrow}
                    </div>
                    <div className="mt-1 text-sm font-medium">{engine.title}</div>
                    <p className="mt-1 text-xs/relaxed text-muted-foreground">
                      {engine.body}
                    </p>
                  </div>
                  <ul className="lp-engine-facts">
                    {engine.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </motion.div>
              </div>
              <div className="p-4 sm:p-5">
                {fixedLanes.active ? (
                  <div
                    className="lp-sequence-lanes lp-sequence-lanes--fixed"
                    aria-hidden="true"
                    style={{ left: fixedLanes.left, width: fixedLanes.width }}
                  >
                    {renderLanes()}
                  </div>
                ) : null}
            <motion.div
              key={engine.id}
              ref={sequenceRef}
              className="lp-sequence-diagram"
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={reduced ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="lp-sequence-lanes" aria-hidden="true">
                {renderLanes()}
              </div>
              <ol className="lp-sequence-flow">
                {engine.flow.map((step, index) => (
                  <motion.li
                    key={`${step.from}-${step.to}-${step.title}`}
                    className="lp-sequence-row"
                    data-reverse={step.from > step.to}
                    data-self={step.from === step.to}
                    initial={reduced ? false : { opacity: 0, y: 12 }}
                    whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-80px" }}
                    transition={{
                      delay: reduced ? 0 : index * 0.055,
                      duration: 0.26,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    <div
                      className="lp-sequence-route"
                      aria-hidden="true"
                      style={routeStyle(step.from, step.to)}
                    >
                      <motion.span
                        className="lp-sequence-route__line"
                        initial={reduced ? false : { scaleX: 0 }}
                        whileInView={reduced ? undefined : { scaleX: 1 }}
                        viewport={{ once: true, margin: "-80px" }}
                        transition={{
                          delay: reduced ? 0 : index * 0.055 + 0.08,
                          duration: 0.34,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                      />
                      <span
                        className="lp-sequence-packet"
                        style={{ animationDelay: `${index * 0.22}s` }}
                      />
                      <span
                        className="lp-sequence-route__state"
                        style={routeStateStyle(step.from, step.to)}
                      >
                        {step.state}
                      </span>
                    </div>
                    <article
                      className="lp-sequence-event"
                      style={{ left: laneCenter(step.lane) }}
                    >
                      <span className="lp-sequence-event__number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{step.title}</div>
                        <p className="mt-1 text-xs/relaxed text-muted-foreground">
                          {step.detail}
                        </p>
                      </div>
                    </article>
                  </motion.li>
                ))}
              </ol>
            </motion.div>
              </div>
            </Card>
          </motion.div>
        </AnimatePresence>
        </div>
        <EnginePeek
          side="next"
          engine={ENGINE_PANELS[nextEngineIndex]}
          index={nextEngineIndex}
          isPeeking={isPeeking}
          muted={hoveredPeek === "prev"}
          onClick={() => goToEngine(nextEngineIndex, 1)}
          onMouseEnter={() => setHoveredPeek("next")}
          onMouseLeave={() => setHoveredPeek(null)}
        />
      </div>
    </section>
  );
}

function EnginePeek({
  side,
  engine,
  index,
  isPeeking,
  muted,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  side: EnginePeekSide;
  engine: EnginePanel;
  index: number;
  isPeeking: boolean;
  muted: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <button
      type="button"
      className={`lp-engine-peek lp-engine-peek--${side}`}
      data-muted={muted}
      tabIndex={isPeeking ? 0 : -1}
      aria-label={`${side === "prev" ? "Previous" : "Next"} engine: ${engine.title}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span className="lp-engine-peek__index">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="lp-engine-peek__copy">
        <strong>{engine.title}</strong>
        <small>{engine.eyebrow}</small>
      </span>
      <span className="lp-engine-peek__lanes" aria-hidden="true">
        {engine.lanes.map((lane) => (
          <span key={lane.label}>
            <span />
            {lane.label}
          </span>
        ))}
      </span>
      <span className="lp-engine-peek__steps" aria-hidden="true">
        {engine.flow.slice(0, 3).map((step) => (
          <span key={`${step.from}-${step.to}-${step.title}`}>
            {step.title}
          </span>
        ))}
      </span>
    </button>
  );
}

function DownloadBlock() {
  return (
    <section id="download" className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Download</h2>
      <Card className="p-4 sm:p-5">
        <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">macOS · Linux · Windows</div>
            <p className="text-xs text-muted-foreground">
              Desktop build from GitHub releases. Uninstall is{" "}
              <code className="font-mono">drag to trash</code>.
            </p>
          </div>
          <SmartDownload
            showAlternates
            className="w-full justify-center sm:w-auto sm:justify-end"
          />
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">
        Want release notes or older builds?{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href={NIGHTLY_URL}
          target="_blank"
          rel="noreferrer"
        >
          Open the release page
        </a>
        .
      </p>
    </section>
  );
}

function CliBlock() {
  return (
    <section id="cli" className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">CLI</h2>
      <Card className="gap-0 overflow-hidden p-0">
        <div className="grid gap-3 border-b p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
          <div className="space-y-1">
            <div className="text-sm font-medium">Or just run it from npm</div>
            <p className="text-xs/relaxed text-muted-foreground">
              Bundled web app + local server + migrations, one command. Starts a
              local HTTP server and opens your browser.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <a
              href={CLI_PACKAGE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-2 font-mono text-sm leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Terminal className="size-4" />
              npm
              <ArrowUpRight className="size-4" />
            </a>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <CopyCommand
            command="bunx g-spot-cli"
            className="rounded-md py-1.5 pl-3 pr-1.5"
            trailing={<PackageSafetyBadge />}
          />
        </div>
      </Card>
    </section>
  );
}

function StackBlock() {
  return (
    <section id="stack" className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Stack</h2>
      <Card className="p-4 sm:p-5">
        <dl className="grid gap-2 text-xs sm:grid-cols-[8rem_1fr]">
          {STACK.map(([key, value], index) => (
            <div
              key={key}
              className="grid gap-1 py-1.5 sm:col-span-2 sm:grid-cols-subgrid sm:gap-2"
              style={{
                borderTop: index === 0 ? undefined : "1px solid var(--border)",
              }}
            >
              <dt className="text-muted-foreground">{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}

function CTA() {
  return (
    <Card className="p-4 sm:p-5">
      <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium">Stop renting your own inbox.</div>
          <p className="text-xs text-muted-foreground">
            One installer. It'll feel like home in five minutes.
          </p>
        </div>
        <div className="grid gap-2 sm:flex sm:items-center">
          <Button
            size="sm"
            className="w-full justify-center sm:w-auto"
            nativeButton={false}
            render={<a href={REPO_URL} target="_blank" rel="noreferrer" />}
          >
            <Github />
            Repo
            <ArrowUpRight />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center sm:w-auto"
            nativeButton={false}
            render={<a href={CLI_PACKAGE_URL} target="_blank" rel="noreferrer" />}
          >
            <Download />
            CLI
            <ArrowUpRight />
          </Button>
        </div>
      </div>
    </Card>
  );
}
