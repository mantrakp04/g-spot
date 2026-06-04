import { Button } from "@g-spot/ui/components/button";
import { Separator } from "@g-spot/ui/components/separator";
import { Github, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { LogoMark } from "./logo-mark";
import { REPO, REPO_URL } from "../lib/site";

const NAV: [string, string][] = [
  ["demo", "#demo"],
  ["features", "#features"],
  ["engine", "#engine"],
  ["download", "#download"],
  ["stack", "#stack"],
];

export function Header() {
  return (
    <header>
      <div className="container mx-auto flex max-w-3xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <a href="#top" className="flex items-center gap-2 font-medium">
          <LogoMark className="size-6" />
          <span className="tracking-tight">g-spot</span>
        </a>
        <nav className="flex w-full items-center gap-3 overflow-x-auto whitespace-nowrap text-sm [-ms-overflow-style:none] [scrollbar-width:none] sm:w-auto sm:gap-4 [&::-webkit-scrollbar]:hidden">
          {NAV.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="text-muted-foreground hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <StarCount />
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 sm:flex-none"
            nativeButton={false}
            render={<a href={REPO_URL} target="_blank" rel="noreferrer" />}
          >
            <Github className="size-4" />
            GitHub
          </Button>
        </div>
      </div>
      <Separator />
    </header>
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
      className="shrink-0 gap-1.5 text-muted-foreground"
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

export function Footer() {
  return (
    <footer>
      <Separator />
      <div className="container mx-auto grid max-w-3xl gap-3 px-4 py-4 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-2">
        <span className="flex items-center gap-2">
          <LogoMark className="size-4" />
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
        <nav className="flex items-center gap-4">
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
