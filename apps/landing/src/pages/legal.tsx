import type { ReactNode } from "react";
import { REPO, REPO_URL } from "../lib/site";

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
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
      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-foreground [&_h2]:mt-6 [&_h2]:text-sm [&_h2]:font-medium [&_h2]:text-foreground [&_strong]:text-foreground">
        {children}
      </div>
    </article>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        <strong>g-spot</strong> is free, open-source software released under the{" "}
        <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
          MIT License
        </a>
        . By downloading, installing, or using it, you agree to these terms.
      </p>
      <h2>1. Use at your own risk</h2>
      <p>
        The software is provided{" "}
        <strong>"as is", without warranty of any kind</strong>, express or
        implied, including but not limited to the warranties of merchantability,
        fitness for a particular purpose, and noninfringement. You are solely
        responsible for any use of the software and for any data, accounts,
        devices, or systems you connect to it.
      </p>
      <h2>2. No liability</h2>
      <p>
        In no event shall the authors, contributors, or copyright holders be
        liable for any claim, damages, or other liability, whether in an action
        of contract, tort, or otherwise, arising from, out of, or in connection
        with the software or its use. This includes, without limitation, lost
        data, lost revenue, account suspensions, missed emails, missed PRs, or
        anything else that goes wrong while you're using it.{" "}
        <strong>If it breaks something, that's on you.</strong>
      </p>
      <h2>3. Third-party services</h2>
      <p>
        g-spot connects to third-party services you choose to authorize (Gmail,
        GitHub, MCP servers, AI providers, etc.). Your use of those services is
        governed by their own terms. We are not a party to that relationship and
        take no responsibility for their availability, behavior, billing, or
        policies.
      </p>
      <h2>4. Your data</h2>
      <p>
        g-spot is local-first. Your data lives on your machine. We do not
        collect, store, or transmit your content to our servers, except as
        strictly required for relay/push features that you opt into. See the{" "}
        <a href="#privacy">Privacy Policy</a> for details.
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
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
          {REPO}/issues
        </a>
        .
      </p>
    </LegalPage>
  );
}

export function Privacy() {
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
        stored locally in a SQLite database on your machine. You can copy, back
        up, or delete that file at any time. Uninstalling the app and deleting
        the data directory removes everything.
      </p>
      <h2>2. Third-party services you connect</h2>
      <p>
        When you sign in to Gmail, GitHub, an AI provider, or an MCP server, the
        app talks to those services{" "}
        <strong>directly from your device</strong> using the credentials you
        provide. Your usage of those services is subject to their own privacy
        policies. We don't proxy your tokens or message content through our
        infrastructure for those direct flows.
      </p>
      <h2>3. The relay (push notifications)</h2>
      <p>
        Some features (e.g. Gmail push sync) require a small relay service so
        third-party providers have a public endpoint to deliver webhooks to. The
        relay forwards <strong>notification metadata only</strong> to your
        device, it does not store the contents of your mail, PRs, or notes.
        Relay traffic is opt-in: if you don't enable push features, the relay is
        not used.
      </p>
      <h2>4. Telemetry</h2>
      <p>
        No analytics, no crash reporting, no usage telemetry is sent to us by
        default. If a future version adds optional telemetry, it will be opt-in
        and disclosed here.
      </p>
      <h2>5. AI / agent calls</h2>
      <p>
        When you use the agent, prompts and tool inputs/outputs are sent to the
        AI provider you configured (e.g. Anthropic, OpenAI, a local model) using
        your own API key. Those providers see your prompts under their own
        policies. We do not see them.
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
        knowingly collect data from anyone, including children.
      </p>
      <h2>8. Changes</h2>
      <p>
        Updates to this policy will be reflected on this page and in the repo's
        git history.
      </p>
      <h2>9. Contact</h2>
      <p>
        Questions or concerns: open an issue at{" "}
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
          {REPO}/issues
        </a>
        .
      </p>
    </LegalPage>
  );
}
