import { Button } from "@g-spot/ui/components/button";
import { Card } from "@g-spot/ui/components/card";
import { Separator } from "@g-spot/ui/components/separator";
import { AlertTriangle, ArrowUpRight, Download, Github, Star } from "lucide-react";
import { useEffect, useState } from "react";

const REPO = "mantrakp04/g-spot";
const REPO_URL = `https://github.com/${REPO}`;
const RELEASES_URL = `${REPO_URL}/releases/latest`;
const NIGHTLY_URL = `${REPO_URL}/releases/tag/desktop-nightly`;

const TITLE_TEXT = `
  ██████╗       ███████╗██████╗  ██████╗ ████████╗
 ██╔════╝       ██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝
 ██║  ███╗█████╗███████╗██████╔╝██║   ██║   ██║
 ██║   ██║╚════╝╚════██║██╔═══╝ ██║   ██║   ██║
 ╚██████╔╝      ███████║██║     ╚██████╔╝   ██║
  ╚═════╝       ╚══════╝╚═╝      ╚═════╝    ╚═╝
`;

const FEATURES: { title: string; body: string }[] = [
  {
    title: "One inbox for mail and code",
    body: "Gmail threads, GitHub PRs, and issues triaged side-by-side. Sectioned, filterable, reorderable. No two tabs, no context-switch tax.",
  },
  {
    title: "Review PRs without leaving home",
    body: "Inline comment threads, CI checks, timelines, stack visualization, and a quiet keyboard-driven action bar.",
  },
  {
    title: "An agent you actually approve",
    body: "Tool calls surface as approval cards before they run. Per-chat sandbox, network toggle, and tool whitelist. The agent asks; you decide.",
  },
  {
    title: "A memory that actually remembers",
    body: "Local knowledge graph with sqlite-vec embeddings. Chat turns auto-ingested. Salience decays over time. The agent recalls last week.",
  },
  {
    title: "Gmail, fully wired",
    body: "Read, compose, drafts, labels, attachments. Inline reply in-thread. A floating draft dock for juggling multiple drafts. Real-time push sync.",
  },
  {
    title: "Local-first by default",
    body: "Ships as an Electrobun desktop app with auto-updates. Your data lives in a SQLite file you can cp. Only the Gmail relay phones home — and only for push.",
  },
];

const STACK: [string, string][] = [
  ["runtime", "bun"],
  ["server", "elysia · tRPC"],
  ["web", "react 19 · tanstack router · tailwind v4"],
  ["data", "drizzle · sqlite · sqlite-vec"],
  ["agent", "pi sdk · approval-gated tool calls"],
  ["desktop", "electrobun · auto-update"],
  ["license", "MIT"],
];

export default function App() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <Header />
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <Hero />
        <section className="mt-14 grid gap-6">
          <FeaturesBlock />
          <DownloadBlock />
          <StackBlock />
          <CTA />
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header>
      <div className="container mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <nav className="flex items-center gap-4 text-sm">
          <a href="#top" className="font-medium">
            g-spot
          </a>
          <a
            href="#features"
            className="text-muted-foreground hover:text-foreground"
          >
            features
          </a>
          <a
            href="#download"
            className="text-muted-foreground hover:text-foreground"
          >
            download
          </a>
          <a
            href="#stack"
            className="text-muted-foreground hover:text-foreground"
          >
            stack
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <StarCount />
          <Button variant="outline" size="sm" nativeButton={false}
            render={<a href={REPO_URL} target="_blank" rel="noreferrer" />}>
            <Github />
            GitHub
          </Button>
        </div>
      </div>
      <Separator />
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="pt-4">
      <pre className="overflow-x-auto font-mono text-xs/5 text-muted-foreground">
        {TITLE_TEXT}
      </pre>
      <div className="mt-6 space-y-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3" />
          alpha · expect bugs &amp; breaking changes
        </span>
        <h1 className="text-2xl font-medium tracking-tight">
          A local-first command center for your mail, code, and memory.
        </h1>
        <p className="text-sm text-muted-foreground">
          g-spot is an open-source desktop app that bundles a Gmail/GitHub
          inbox, a PR review surface, an approval-gated AI agent, and a memory
          graph into one quiet window. It runs on your machine. It ships as a
          single install.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            nativeButton={false}
            render={<a href={RELEASES_URL} target="_blank" rel="noreferrer" />}
          >
            <Download />
            Download
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={REPO_URL} target="_blank" rel="noreferrer" />}
          >
            <Github />
            Star on GitHub
            <ArrowUpRight />
          </Button>
        </div>
      </div>
    </section>
  );
}

function FeaturesBlock() {
  return (
    <section id="features" className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Features</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Card key={f.title} className="p-4">
            <div className="space-y-1.5 px-4">
              <h3 className="text-sm font-medium">{f.title}</h3>
              <p className="text-xs/relaxed text-muted-foreground">{f.body}</p>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function DownloadBlock() {
  return (
    <section id="download" className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Download</h2>
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              macOS · Linux · Windows
            </div>
            <p className="text-xs text-muted-foreground">
              Stable build. Auto-updates from GitHub releases. Uninstall is{" "}
              <code className="font-mono">drag to trash</code>.
            </p>
          </div>
          <Button
            size="sm"
            nativeButton={false}
            render={<a href={RELEASES_URL} target="_blank" rel="noreferrer" />}
          >
            <Download />
            Download stable
          </Button>
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">
        Want the bleeding edge?{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href={NIGHTLY_URL}
          target="_blank"
          rel="noreferrer"
        >
          Grab the nightly
        </a>
        .
      </p>
    </section>
  );
}

function StackBlock() {
  return (
    <section id="stack" className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Stack</h2>
      <Card className="p-4">
        <dl className="grid gap-2 px-4 text-xs sm:grid-cols-[8rem_1fr]">
          {STACK.map(([k, v], i) => (
            <div
              key={k}
              className="grid grid-cols-subgrid gap-2 py-1.5 sm:col-span-2"
              style={{
                borderTop: i === 0 ? undefined : "1px solid var(--border)",
              }}
            >
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}

function CTA() {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4">
        <div>
          <div className="text-sm font-medium">Ready to try it?</div>
          <p className="text-xs text-muted-foreground">
            One installer. It'll feel like home in five minutes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            nativeButton={false}
            render={<a href={RELEASES_URL} target="_blank" rel="noreferrer" />}
          >
            <Download />
            Download
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={REPO_URL} target="_blank" rel="noreferrer" />}
          >
            <Github />
            Repo
            <ArrowUpRight />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function StarCount() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/repos/${REPO}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-muted-foreground"
      nativeButton={false}
      render={
        <a
          href={`${REPO_URL}/stargazers`}
          target="_blank"
          rel="noreferrer"
          aria-label="Stargazers"
        />
      }
    >
      <Star className="size-3.5" />
      <span className="font-mono tabular-nums">
        {stars === null ? "—" : formatStars(stars)}
      </span>
    </Button>
  );
}

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function Footer() {
  return (
    <footer>
      <Separator />
      <div className="container mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground">
        <span>
          MIT © {new Date().getFullYear()} ·{" "}
          <a
            className="hover:text-foreground"
            href="https://github.com/mantrakp04"
            target="_blank"
            rel="noreferrer"
          >
            @mantrakp04
          </a>
        </span>
      </div>
    </footer>
  );
}
