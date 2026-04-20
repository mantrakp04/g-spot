import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Settings2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import { Switch } from "@g-spot/ui/components/switch";

export type DiffSettings = {
  ignoreWhitespace: boolean;
  softWrap: boolean;
  tabWidth: 2 | 4 | 8;
  fontSize: 12 | 13 | 14 | 16;
};

const STORAGE_KEY = "gspot:review:diff-settings";

const DEFAULT_SETTINGS: DiffSettings = {
  ignoreWhitespace: false,
  softWrap: true,
  tabWidth: 2,
  fontSize: 12,
};

function readSettings(): DiffSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<DiffSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const listeners = new Set<() => void>();
let cached: DiffSettings | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cached = readSettings();
      for (const l of listeners) l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): DiffSettings {
  if (cached == null) cached = readSettings();
  return cached;
}

function getServerSnapshot(): DiffSettings {
  return DEFAULT_SETTINGS;
}

function writeSettings(next: DiffSettings) {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

export function useDiffSettings(): [
  DiffSettings,
  (patch: Partial<DiffSettings>) => void,
] {
  const settings = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const update = useCallback((patch: Partial<DiffSettings>) => {
    writeSettings({ ...getSnapshot(), ...patch });
  }, []);
  return [settings, update];
}

/** Read-only access without subscribing. */
export function getDiffSettings(): DiffSettings {
  return getSnapshot();
}

export function DiffSettingsMenu() {
  const [settings, update] = useDiffSettings();

  // Hydrate once on mount so SSR snapshot doesn't linger if cached is null.
  useEffect(() => {
    cached = readSettings();
  }, []);

  const row = "flex items-center justify-between gap-3 px-2 py-1.5 text-[12px]";
  const segBtn = (active: boolean) =>
    `px-1.5 py-0.5 text-[11px] ${
      active
        ? "bg-muted text-foreground"
        : "text-muted-foreground/70 hover:text-foreground"
    }`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-sm border border-border/50 bg-card text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            aria-label="Diff settings"
            title="Diff settings"
          >
            <Settings2 className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[240px] p-1">
        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          Diff settings
        </div>
        <DropdownMenuSeparator />
        <div className={row}>
          <span>Ignore whitespace</span>
          <Switch
            checked={settings.ignoreWhitespace}
            onCheckedChange={(v) => update({ ignoreWhitespace: v })}
          />
        </div>
        <div className={row}>
          <span>Soft wrap</span>
          <Switch
            checked={settings.softWrap}
            onCheckedChange={(v) => update({ softWrap: v })}
          />
        </div>
        <DropdownMenuSeparator />
        <div className={row}>
          <span>Tab width</span>
          <div className="inline-flex overflow-hidden rounded-sm border border-border/50 bg-card">
            {([2, 4, 8] as const).map((n, i) => (
              <div key={n} className="flex items-center">
                {i > 0 ? <div className="w-px bg-border/50" /> : null}
                <button
                  type="button"
                  className={segBtn(settings.tabWidth === n)}
                  onClick={() => update({ tabWidth: n })}
                >
                  {n}
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className={row}>
          <span>Font size</span>
          <div className="inline-flex overflow-hidden rounded-sm border border-border/50 bg-card">
            {([12, 13, 14, 16] as const).map((n, i) => (
              <div key={n} className="flex items-center">
                {i > 0 ? <div className="w-px bg-border/50" /> : null}
                <button
                  type="button"
                  className={segBtn(settings.fontSize === n)}
                  onClick={() => update({ fontSize: n })}
                >
                  {n}
                </button>
              </div>
            ))}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
