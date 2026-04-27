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
    title: "Pi builds your filters",
    body: "Describe the slice you want — \"unread PRs from my team waiting on me\" — and the agent assembles the filter rules, account, and columns for you.",
  },
  {
    title: "Review PRs without leaving home",
    body: "Inline comment threads, CI checks, timelines, stack visualization, and a quiet keyboard-driven action bar.",
  },
  {
    title: "Notes that link back",
    body: "CodeMirror markdown editor with wikilinks, tags, KaTeX math, Mermaid diagrams, daily notes, embeds, and full-text search. Stored locally, linked everywhere.",
  },
  {
    title: "An agent you actually approve",
    body: "Tool calls surface as approval cards before they run. Per-chat sandbox, network toggle, and tool whitelist. Bring your own MCP servers. The agent asks; you decide.",
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
    body: "Ships as an Electrobun desktop app with auto-updates. Your data lives in a SQLite file you can cp. Only the relay phones home — and only for push.",
  },
];

const STACK: [string, string][] = [
  ["runtime", "bun"],
  ["server", "elysia · tRPC"],
  ["web", "react 19 · tanstack router · tailwind v4"],
  ["data", "drizzle · sqlite · sqlite-vec"],
  ["agent", "pi sdk · approval-gated tool calls · mcp"],
  ["notes", "codemirror 6 · katex · mermaid · wikilinks"],
  ["desktop", "electrobun · auto-update"],
  ["license", "MIT"],
];

function useHashRoute(): string {
  const [hash, setHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "")
  );
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.replace(/^#/, ""));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash;
}

export default function App() {
  const route = useHashRoute();
  const page =
    route === "terms" ? <Terms /> : route === "privacy" ? <Privacy /> : <Home />;

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Header />
      <main className="container mx-auto max-w-3xl px-4 py-10">{page}</main>
      <Footer />
    </div>
  );
}

function Home() {
  return (
    <>
      <Hero />
      <section className="mt-14 grid gap-6">
        <FeaturesBlock />
        <DownloadBlock />
        <StackBlock />
        <CTA />
      </section>
    </>
  );
}

function LegalPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="prose prose-sm max-w-none space-y-4 pt-2 dark:prose-invert">
      <a
        href="#"
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        ← back
      </a>
      <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
      <p className="text-xs text-muted-foreground">
        Last updated: {new Date().toISOString().slice(0, 10)}
      </p>
      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-6 [&_h2]:text-sm [&_h2]:font-medium [&_h2]:text-foreground [&_strong]:text-foreground">
        {children}
      </div>
    </article>
  );
}

function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        <strong>g-spot</strong> is free, open-source software released under the{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href={`${REPO_URL}/blob/main/LICENSE`}
          target="_blank"
          rel="noreferrer"
        >
          MIT License
        </a>
        . By downloading, installing, or using it, you agree to these terms.
      </p>

      <h2>1. Use at your own risk</h2>
      <p>
        The software is provided <strong>"as is", without warranty of any kind</strong>,
        express or implied, including but not limited to the warranties of
        merchantability, fitness for a particular purpose, and noninfringement.
        You are solely responsible for any use of the software and for any data,
        accounts, devices, or systems you connect to it.
      </p>

      <h2>2. No liability</h2>
      <p>
        In no event shall the authors, contributors, or copyright holders be
        liable for any claim, damages, or other liability — whether in an
        action of contract, tort, or otherwise — arising from, out of, or in
        connection with the software or its use. This includes, without
        limitation, lost data, lost revenue, account suspensions, missed
        emails, missed PRs, or anything else that goes wrong while you're using
        it. <strong>If it breaks something, that's on you.</strong>
      </p>

      <h2>3. Third-party services</h2>
      <p>
        g-spot connects to third-party services you choose to authorize (Gmail,
        GitHub, MCP servers, AI providers, etc.). Your use of those services is
        governed by their own terms. We are not a party to that relationship
        and take no responsibility for their availability, behavior, billing,
        or policies.
      </p>

      <h2>4. Your data</h2>
      <p>
        g-spot is local-first. Your data lives on your machine. We do not
        collect, store, or transmit your content to our servers, except as
        strictly required for relay/push features that you opt into. See the{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href="#privacy"
        >
          Privacy Policy
        </a>{" "}
        for details.
      </p>

      <h2>5. No support obligation</h2>
      <p>
        This is a hobby/open-source project. There is no SLA, no guaranteed
        support, and no promise of continued development. Issues and PRs are
        welcome on GitHub but may go unanswered.
      </p>

      <h2>6. Changes</h2>
      <p>
        These terms may change at any time. Continued use after changes
        constitutes acceptance. The canonical version always lives in this
        repo's git history.
      </p>

      <h2>7. Contact</h2>
      <p>
        File an issue at{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href={`${REPO_URL}/issues`}
          target="_blank"
          rel="noreferrer"
        >
          {REPO}/issues
        </a>
        .
      </p>
    </LegalPage>
  );
}

function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        <strong>g-spot</strong> is a local-first desktop app. The short version:
        your data stays on your machine, we don't have servers that store your
        content, and we don't track you.
      </p>

      <h2>1. What lives on your device</h2>
      <p>
        Your mail, PRs, notes, chat history, agent memory, and credentials are
        stored locally in a SQLite database on your machine. You can copy,
        back up, or delete that file at any time. Uninstalling the app and
        deleting the data directory removes everything.
      </p>

      <h2>2. Third-party services you connect</h2>
      <p>
        When you sign in to Gmail, GitHub, an AI provider, or an MCP server,
        the app talks to those services <strong>directly from your device</strong>{" "}
        using the credentials you provide. Your usage of those services is
        subject to their own privacy policies. We don't proxy your tokens or
        message content through our infrastructure for those direct flows.
      </p>

      <h2>3. The relay (push notifications)</h2>
      <p>
        Some features (e.g. Gmail push sync) require a small relay service so
        third-party providers have a public endpoint to deliver webhooks to.
        The relay forwards <strong>notification metadata only</strong> to your
        device — it does not store the contents of your mail, PRs, or notes.
        Relay traffic is opt-in: if you don't enable push features, the relay
        is not used.
      </p>

      <h2>4. Telemetry</h2>
      <p>
        No analytics, no crash reporting, no usage telemetry is sent to us by
        default. If a future version adds optional telemetry, it will be
        opt-in and disclosed here.
      </p>

      <h2>5. AI / agent calls</h2>
      <p>
        When you use the agent, prompts and tool inputs/outputs are sent to
        the AI provider you configured (e.g. Anthropic, OpenAI, a local model)
        using your own API key. Those providers see your prompts under their
        own policies. We do not see them.
      </p>

      <h2>6. Cookies / tracking on this site</h2>
      <p>
        This landing page sets no cookies and runs no analytics. It does fetch
        the public GitHub stargazer count from{" "}
        <code className="font-mono">api.github.com</code> when loaded.
      </p>

      <h2>7. Children</h2>
      <p>
        The software is not directed at children under 13 and we do not
        knowingly collect data from anyone — including children.
      </p>

      <h2>8. Changes</h2>
      <p>
        Updates to this policy will be reflected on this page and in the
        repo's git history.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions or concerns: open an issue at{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href={`${REPO_URL}/issues`}
          target="_blank"
          rel="noreferrer"
        >
          {REPO}/issues
        </a>
        .
      </p>
    </LegalPage>
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
          A local-first command center for your mail, code, notes, and memory.
        </h1>
        <p className="text-sm text-muted-foreground">
          g-spot is an open-source desktop app that bundles a Gmail/GitHub
          inbox, a PR review surface, an Obsidian-style notes workspace, an
          approval-gated AI agent, and a memory graph into one quiet window.
          It runs on your machine. It ships as a single install.
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
        <nav className="flex items-center gap-3">
          <a className="hover:text-foreground" href="#terms">
            Terms
          </a>
          <a className="hover:text-foreground" href="#privacy">
            Privacy
          </a>
          <a
            className="hover:text-foreground"
            href={`${REPO_URL}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
          >
            License
          </a>
        </nav>
      </div>
    </footer>
  );
}
