import { Button } from "@g-spot/ui/components/button";
import { Card } from "@g-spot/ui/components/card";
import { Separator } from "@g-spot/ui/components/separator";
import { ArrowUpRight, Check, Copy, Github } from "lucide-react";
import { useState } from "react";

const REPO = "mantrakp04/g-spot";
const REPO_URL = `https://github.com/${REPO}`;

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
    body: "Gmail threads and GitHub issues triaged side-by-side. No two tabs, no context-switch tax.",
  },
  {
    title: "Review PRs without leaving home",
    body: "Inline threads, stack visualization, and a quiet action bar. Your diffs, your keybindings.",
  },
  {
    title: "A memory that actually remembers",
    body: "A local knowledge graph with embeddings. Your agents recall what you told them last week.",
  },
  {
    title: "Local-first by default",
    body: "Ships as an Electrobun desktop app. Your data lives in a SQLite file you can cp.",
  },
];

const STACK: [string, string][] = [
  ["runtime", "bun"],
  ["server", "elysia · tRPC"],
  ["web", "react 19 · tanstack router · tailwind v4"],
  ["data", "drizzle · sqlite · sqlite-vec"],
  ["desktop", "electrobun"],
  ["license", "MIT"],
];

const INSTALL = `# clone
git clone https://github.com/${REPO}
cd g-spot

# install & push schema
bun install
bun run db:push

# run the desktop app
bun dev:desktop`;

export default function App() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <Header />
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <Hero />
        <section className="mt-14 grid gap-6">
          <Status />
          <FeaturesBlock />
          <InstallBlock />
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
            href="#install"
            className="text-muted-foreground hover:text-foreground"
          >
            install
          </a>
          <a
            href="#stack"
            className="text-muted-foreground hover:text-foreground"
          >
            stack
          </a>
        </nav>
        <div className="flex items-center gap-2">
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
        <h1 className="text-2xl font-medium tracking-tight">
          A local-first command center for your mail, code, and memory.
        </h1>
        <p className="text-sm text-muted-foreground">
          g-spot is an open-source desktop app that bundles a Gmail/GitHub
          inbox, a PR review surface, and a memory graph into one quiet window.
          It runs on your machine. It ships as a single install.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <CopyInstall />
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

function Status() {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 px-4 py-1">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
          <span className="text-xs">
            <span className="text-muted-foreground">status: </span>
            <span>local-first · no cloud · no telemetry</span>
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          v0.1 — built in public
        </span>
      </div>
    </Card>
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

function InstallBlock() {
  return (
    <section id="install" className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Install</h2>
      <Card className="p-0">
        <pre className="overflow-x-auto px-4 py-4 font-mono text-xs/relaxed text-foreground/90">
          {INSTALL}
        </pre>
      </Card>
      <p className="text-xs text-muted-foreground">
        Three commands, one desktop window. Uninstall is{" "}
        <code className="font-mono">rm -rf</code>.
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
            Clone the repo. It'll feel like home in five minutes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CopyInstall compact />
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

function CopyInstall({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const cmd = `git clone https://github.com/${REPO}`;

  return (
    <Button
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(cmd).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {compact ? (
        copied ? (
          "copied"
        ) : (
          "copy install"
        )
      ) : (
        <span className="font-mono">
          {copied ? "copied" : `git clone ${REPO}`}
        </span>
      )}
    </Button>
  );
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
        <span>no cookies · no trackers · no telemetry</span>
      </div>
    </footer>
  );
}
