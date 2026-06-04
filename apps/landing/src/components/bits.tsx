import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ArrowUpRight, Check, Copy, Download, Github } from "lucide-react";
import { DEMO_URL, DOWNLOAD_RELEASE_TAG, RELEASES_URL, REPO } from "../lib/site";

const HeroLogo3D = lazy(() => import("./logo-3d"));
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/* ---- hooks -------------------------------------------------------- */

function subscribeToReducedMotion(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    () => false,
  );
}

/** Fires once when the element first scrolls near the viewport. */
function useInView<T extends HTMLElement>(rootMargin = "120px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView] as const;
}

/* ---- scroll reveal ------------------------------------------------ */

export function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li";
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement & HTMLLIElement>}
      className={`lp-reveal ${className}`}
      data-shown={inView ? "true" : "false"}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

/* ---- links / CTAs ------------------------------------------------- */

const base =
  "inline-flex h-8 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors [&_svg]:shrink-0";

export function PrimaryLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target={href.startsWith("#") ? undefined : "_blank"}
      rel={href.startsWith("#") ? undefined : "noreferrer"}
      className={`lp-cta ${base} bg-primary px-3 text-primary-foreground shadow-[var(--shadow)] hover:bg-primary/90 ${className}`}
    >
      <span className="relative z-[2] inline-flex items-center gap-2">{children}</span>
    </a>
  );
}

/* ---- os-aware smart download -------------------------------------- */

type OS = "macos" | "windows" | "linux" | "unknown";

const OS_LABEL: Record<OS, string> = {
  macos: "Download for macOS",
  windows: "Download for Windows",
  linux: "Download for Linux",
  unknown: "Download",
};

const DOWNLOAD_OSES = ["macos", "linux", "windows"] as const;
const DOWNLOAD_BASE_URL = RELEASES_URL.replace(
  "/releases/tag/",
  "/releases/download/",
);
const DIRECT_DOWNLOAD_URLS = {
  macos: `${DOWNLOAD_BASE_URL}/canary-macos-arm64-g-spot-canary.dmg`,
  linux: `${DOWNLOAD_BASE_URL}/canary-linux-x64-g-spot-canary-Setup.tar.gz`,
  windows: `${DOWNLOAD_BASE_URL}/canary-win-x64-g-spot-Setup-canary.exe`,
} satisfies Record<(typeof DOWNLOAD_OSES)[number], string>;

function detectOS(): OS {
  if (typeof navigator === "undefined") return "unknown";
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData;
  const hint = `${uaData?.platform ?? ""} ${navigator.userAgent} ${
    navigator.platform ?? ""
  }`.toLowerCase();
  if (/mac|darwin|iphone|ipad|ipod/.test(hint)) return "macos";
  if (/win/.test(hint)) return "windows";
  if (/linux|x11|cros/.test(hint)) return "linux";
  return "unknown";
}

function useDetectedOS() {
  const [os, setOS] = useState<OS>(detectOS);

  useEffect(() => {
    const sync = () => setOS((current) => {
      const next = detectOS();
      return next === current ? current : next;
    });

    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("resize", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("resize", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return os;
}

/** Inline OS glyphs — lucide has no brand logos. */
function OSGlyph({
  os,
  className = "size-4",
}: {
  os: OS;
  className?: string;
}) {
  if (os === "macos")
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
        <path d="M16.36 12.5c.02 2.6 2.27 3.46 2.3 3.48-.02.06-.36 1.23-1.18 2.44-.71 1.05-1.45 2.09-2.62 2.11-1.14.02-1.51-.67-2.82-.67s-1.71.65-2.79.69c-1.12.04-1.98-1.13-2.7-2.18-1.47-2.13-2.59-6.02-1.08-8.65.75-1.3 2.09-2.13 3.55-2.15 1.1-.02 2.14.74 2.82.74.67 0 1.94-.92 3.27-.78.56.02 2.12.22 3.12 1.69-.08.05-1.86 1.09-1.84 3.25zM14.2 4.92c.6-.73 1-1.74.89-2.75-.86.03-1.91.57-2.53 1.3-.56.64-1.04 1.67-.91 2.66.96.07 1.94-.49 2.55-1.21z" />
      </svg>
    );
  if (os === "windows")
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
        <path d="M3 5.7 10.4 4.6v6.7H3V5.7zM3 12.7h7.4v6.7L3 18.3v-5.6zM11.3 4.5 21 3v8.3h-9.7V4.5zM11.3 12.7H21V21l-9.7-1.5v-6.8z" />
      </svg>
    );
  if (os === "linux")
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
        <path d="M12 2c-2.2 0-3.8 1.9-3.8 4.4 0 1.2.3 2 .3 3 0 1-.7 1.7-1.6 3-.9 1.3-2 2.6-2 4.5 0 .8.3 1.4.8 1.8-.2.4-.3.8-.1 1.2.4.7 1.5.8 2.7.8.6 0 1.1.4 1.8.6.5.2 1.1.3 1.9.3s1.4-.1 1.9-.3c.7-.2 1.2-.6 1.8-.6 1.2 0 2.3-.1 2.7-.8.2-.4.1-.8-.1-1.2.5-.4.8-1 .8-1.8 0-1.9-1.1-3.2-2-4.5-.9-1.3-1.6-2-1.6-3 0-1 .3-1.8.3-3C15.8 3.9 14.2 2 12 2zm-1.5 4.1c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9zm3 0c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9zm-1.5 2.4c.7 0 1.6.5 1.6.9 0 .3-.5.5-1 .7-.2.1-.4.3-.6.3s-.4-.2-.6-.3c-.5-.2-1-.4-1-.7 0-.4.9-.9 1.6-.9z" />
      </svg>
    );
  return <Download className={className} />;
}

type Release = {
  draft: boolean;
  assets: { name: string; browser_download_url: string }[];
};

/** Ordered suffix preferences per OS; first match wins. */
const ASSET_RULES: Record<
  Exclude<OS, "unknown">,
  { keys: string[]; exts: string[] }
> = {
  macos: { keys: ["macos", "darwin"], exts: [".dmg"] },
  windows: { keys: ["win"], exts: [".exe", ".msi", ".zip"] },
  linux: { keys: ["linux"], exts: [".appimage", ".deb", ".tar.gz"] },
};

function resolveAssetUrl(release: Release, os: OS): string | null {
  if (os === "unknown") return null;
  const rule = ASSET_RULES[os];
  const candidates = release.assets.filter((a) => {
    const name = a.name.toLowerCase();
    return rule.keys.some((k) => name.includes(k));
  });
  for (const ext of rule.exts) {
    const hit = candidates.find((a) => a.name.toLowerCase().endsWith(ext));
    if (hit) return hit.browser_download_url;
  }
  return null;
}

async function fetchDownloadRelease(): Promise<Release | null> {
  const api = `https://api.github.com/repos/${REPO}`;
  try {
    const res = await fetch(`${api}/releases/tags/${DOWNLOAD_RELEASE_TAG}`);
    if (res.ok) return (await res.json()) as Release;
  } catch {
    /* fall through to listing */
  }
  try {
    const res = await fetch(`${api}/releases?per_page=10`);
    if (!res.ok) return null;
    const list = (await res.json()) as Release[];
    return list.find((r) => !r.draft) ?? null;
  } catch {
    return null;
  }
}

export function SmartDownload({
  className = "",
  showAlternates = false,
}: {
  className?: string;
  showAlternates?: boolean;
}) {
  const os = useDetectedOS();
  const [assetUrls, setAssetUrls] = useState<Partial<Record<Exclude<OS, "unknown">, string>>>({});

  useEffect(() => {
    let active = true;
    fetchDownloadRelease().then((release) => {
      if (!active || !release) return;
      const urls = Object.fromEntries(
        DOWNLOAD_OSES.flatMap((candidate) => {
          const url = resolveAssetUrl(release, candidate);
          return url ? [[candidate, url]] : [];
        }),
      ) as Partial<Record<Exclude<OS, "unknown">, string>>;
      setAssetUrls(urls);

    });
    return () => {
      active = false;
    };
  }, []);

  const href =
    os === "unknown" ? RELEASES_URL : (assetUrls[os] ?? DIRECT_DOWNLOAD_URLS[os]);
  const isDirect = href !== RELEASES_URL;
  const label = OS_LABEL[os];
  const alternateOss = DOWNLOAD_OSES.filter((candidate) => candidate !== os);

  return (
    <div className={`flex flex-wrap items-center gap-2.5 ${className}`}>
      <a
        href={href}
        target={isDirect ? undefined : "_blank"}
        rel={isDirect ? undefined : "noreferrer"}
        download={isDirect ? "" : undefined}
        aria-label={label}
        className={`lp-cta ${base} bg-primary px-3 text-primary-foreground shadow-[var(--shadow)] hover:bg-primary/90`}
      >
        <span className="relative z-[2] inline-flex items-center gap-2">
          <OSGlyph os={os} />
          {label}
        </span>
      </a>
      {showAlternates &&
        alternateOss.map((candidate) => {
          const alternateHref = assetUrls[candidate] ?? DIRECT_DOWNLOAD_URLS[candidate];
          const direct = alternateHref !== RELEASES_URL;
          return (
            <a
              key={candidate}
              href={alternateHref}
              target={direct ? undefined : "_blank"}
              rel={direct ? undefined : "noreferrer"}
              download={direct ? "" : undefined}
              aria-label={OS_LABEL[candidate]}
              title={OS_LABEL[candidate]}
              className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--lp-line)] bg-background text-[var(--lp-ink)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--lp-violet)]/40 hover:bg-muted hover:text-[var(--lp-violet)]"
            >
              <OSGlyph os={candidate} />
            </a>
          );
        })}
      {showAlternates && (
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="View GitHub releases"
          title="View GitHub releases"
          className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--lp-line)] bg-background text-[var(--lp-ink)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--lp-violet)]/40 hover:bg-muted hover:text-[var(--lp-violet)]"
        >
          <Github className="size-4" />
        </a>
      )}
    </div>
  );
}

export function GhostLink({
  href,
  children,
  external = true,
  className = "",
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
  className?: string;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={`${base} border border-[var(--lp-line)] bg-background px-3 text-[var(--lp-ink)] hover:bg-muted ${className}`}
    >
      {children}
    </a>
  );
}

/* ---- copyable command bar ----------------------------------------- */

export function CopyCommand({
  command = "bunx g-spot-cli",
  className = "",
  id,
  trailing,
}: {
  command?: string;
  className?: string;
  id?: string;
  trailing?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div
      id={id}
      className={`flex items-center rounded-xl border border-[var(--lp-line)] bg-[var(--card)] py-2.5 pl-4 pr-2.5 shadow-[var(--shadow-sm)] ${className}`}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--lp-ink)]">
        <span aria-hidden className="select-none text-[var(--lp-violet)]">
          ${" "}
        </span>
        <span className="select-all">{command}</span>
      </code>
      <div className="ml-2 flex shrink-0 items-center gap-1.5">
        {trailing}
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy command"}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--lp-ink-soft)] transition-colors hover:bg-[var(--lp-violet)]/10 hover:text-[var(--lp-violet)]"
        >
          {copied ? (
            <Check className="size-4 text-[var(--lp-violet)]" />
          ) : (
            <Copy className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}

/* ---- hero 3D stage ------------------------------------------------ */

export function HeroStage() {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>("200px");

  return (
    <div ref={ref} className="relative aspect-square w-full">
      {inView && (
        <>
          <div className="lp-halo pointer-events-none absolute inset-[8%] rounded-full opacity-80" />
          <Suspense fallback={null}>
            <HeroLogo3D reduced={reduced} />
          </Suspense>
        </>
      )}
    </div>
  );
}

/* ---- live demo frame ---------------------------------------------- */

const DEMO_DESKTOP_WIDTH = 1280;
const DEMO_DESKTOP_HEIGHT = 792;
const DEMO_CHROME_HEIGHT = 40;
const DEMO_FRAME_HEIGHT = DEMO_DESKTOP_HEIGHT + DEMO_CHROME_HEIGHT;

export function DemoFrame({ className = "" }: { className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>("300px");
  const frameRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateScale = () => {
      setScale(Math.min(1, frame.clientWidth / DEMO_DESKTOP_WIDTH));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`lp-glass relative isolate overflow-hidden rounded-[14px] ${className}`}
    >
      <div
        ref={frameRef}
        className="relative w-full bg-[var(--lp-bg-sunk)]"
        style={{ height: `${DEMO_FRAME_HEIGHT * scale}px` }}
      >
        <div
          className="absolute left-0 top-0 overflow-hidden rounded-[inherit]"
          style={{
            width: DEMO_DESKTOP_WIDTH,
            height: DEMO_FRAME_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {/* faux titlebar */}
          <div className="flex h-10 items-center gap-2 border-b border-white/15 bg-black/35 px-4 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)]">
            <span className="size-2.5 rounded-full bg-[var(--lp-mauve)] opacity-85" />
            <span className="size-2.5 rounded-full bg-[var(--lp-teal)] opacity-85" />
            <span className="size-2.5 rounded-full bg-[var(--lp-violet)] opacity-70" />
            <span className="ml-3 font-mono text-[13px] text-foreground/75">
              demo.g-spot.dev · read-only
            </span>
            <a
              href={DEMO_URL}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1.5 font-mono text-[13px] text-foreground/75 transition-colors hover:text-foreground"
            >
              open <ArrowUpRight className="size-4" />
            </a>
          </div>
          <div
            className="relative w-full bg-[var(--lp-bg-sunk)]"
            style={{ height: DEMO_DESKTOP_HEIGHT }}
          >
            {/* skeleton while the iframe loads */}
            {!loaded && (
              <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[var(--lp-bg-sunk)] via-white/40 to-[var(--lp-bg-sunk)]" />
            )}
            {inView && (
              <iframe
                title="g-spot live demo"
                src={DEMO_URL}
                loading="lazy"
                onLoad={() => setLoaded(true)}
                className="size-full border-0"
                style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.5s ease" }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
