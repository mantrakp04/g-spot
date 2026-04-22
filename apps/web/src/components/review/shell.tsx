import { useEffect, useRef, useState, type ReactNode } from "react";

import { useHotkey } from "@tanstack/react-hotkeys";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";

import { KeyboardOverlay } from "./keyboard-overlay";

/**
 * Graphite-style shell: top header strip that swaps between "full" and
 * "condensed" as the user scrolls, a centered main content column, and a
 * fixed right metadata sidebar.
 */
export function ReviewShell({
  fullHeader,
  condensedHeader,
  main,
  rightSidebar,
  actions,
  isLoading,
}: {
  fullHeader: ReactNode;
  condensedHeader: ReactNode;
  main: ReactNode;
  rightSidebar: ReactNode;
  actions?: ReactNode;
  isLoading?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fullHeaderRef = useRef<HTMLDivElement | null>(null);
  const [condensed, setCondensed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useHotkey(
    { key: "?" },
    () => setHelpOpen((s) => !s),
    { meta: { name: "Toggle keyboard help" } },
  );

  useEffect(() => {
    const root = scrollRef.current;
    const header = fullHeaderRef.current;
    if (!root || !header) return;
    // Track whether the fullHeader has scrolled out of the viewport. The
    // header stays mounted so there's no layout jump toggling `condensed`.
    const onScroll = () => {
      const hidden = header.getBoundingClientRect().bottom < 48;
      setCondensed((prev) => (prev !== hidden ? hidden : prev));
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="graphite-scope relative flex h-full min-w-0 flex-col overflow-hidden">
      <KeyboardOverlay open={helpOpen} onOpenChange={setHelpOpen} />
      {isLoading ? <div className="graphite-loading-bar" aria-hidden /> : null}
      <div
        data-condensed={condensed ? "true" : "false"}
        style={{ boxShadow: condensed ? "0 1px 3px 0 rgb(0 0 0 / 0.1)" : "none" }}
        className="relative z-10 flex min-h-[48px] items-center gap-3 overflow-hidden border-b border-border/50 bg-background px-4 sm:px-6 lg:px-8"
      >
        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden transition-opacity duration-150",
            condensed ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {condensedHeader}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen((s) => !s)}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-expanded={sidebarOpen}
          className="hidden shrink-0 lg:inline-flex"
        >
          {sidebarOpen ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
      </div>
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-4 px-4 sm:px-6 lg:flex-row lg:gap-8 lg:px-8">
          <div className="min-w-0 flex-1">
            <div ref={fullHeaderRef}>{fullHeader}</div>
            {main}
          </div>
          {sidebarOpen ? (
            <aside className="order-last w-full shrink-0 pb-6 lg:sticky lg:top-0 lg:order-none lg:h-fit lg:w-[300px] lg:py-6">
              {rightSidebar}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
