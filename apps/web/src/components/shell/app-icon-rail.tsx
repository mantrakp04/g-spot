import { useCallback, useEffect, useState } from "react";

import { Button } from "@g-spot/ui/components/button";
import { env } from "@g-spot/env/web";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@hexclave/react";
import { CatchBoundary, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BotIcon,
  BrainIcon,
  Inbox,
  LogIn,
  MailCheck,
  NotebookText,
} from "lucide-react";
import { toast } from "sonner";

import { Logo } from "@/components/logo";
import { NavUser } from "@/components/nav-user";
import { DesktopUpdateButton } from "@/components/desktop-update-button";
import { ThemePicker } from "@/components/tweakcn-theme-picker";
import { DEMO_ROTATION_INTERVAL_MS, isEmbeddedFrame, useDemoInteractionPause } from "@/lib/demo-mode";
import { signInWithExternalBrowser } from "@/lib/desktop-auth";

type RailItemTarget = "/" | "/notes" | "/memory" | "/workflows" | "/agent";

type RailItem = {
  id: string;
  label: string;
  icon: typeof Inbox;
  to: RailItemTarget;
  matches: (pathname: string) => boolean;
};

const ITEMS: RailItem[] = [
  {
    id: "sections",
    label: "Sections",
    icon: Inbox,
    to: "/",
    matches: (p) => p === "/",
  },
  {
    id: "notes",
    label: "Notes",
    icon: NotebookText,
    to: "/notes",
    matches: (p) => p.startsWith("/notes"),
  },
  {
    id: "memory",
    label: "Memory",
    icon: BrainIcon,
    to: "/memory",
    matches: (p) => p.startsWith("/memory"),
  },
  {
    id: "workflows",
    label: "Workflows",
    icon: MailCheck,
    to: "/workflows",
    matches: (p) => p.startsWith("/workflows"),
  },
  {
    id: "ai",
    label: "Agent",
    icon: BotIcon,
    to: "/agent",
    matches: (p) =>
      p.startsWith("/agent") || p.startsWith("/projects") || p.startsWith("/chat"),
  },
];

function RailButton({ item, active }: { item: RailItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      title={item.label}
      aria-label={item.label}
      className={cn(
        "flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
        active && "bg-sidebar-accent text-foreground",
      )}
    >
      <Icon className="size-4" />
    </Link>
  );
}

function SignInButton() {
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      await signInWithExternalBrowser();
      toast.success("Signed in");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSigningIn(false);
    }
  }, []);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
      disabled={signingIn}
      onClick={handleSignIn}
      aria-label={signingIn ? "Waiting for browser" : "Sign in"}
      title={signingIn ? "Waiting for browser" : "Sign in"}
    >
      <LogIn className="size-4" />
    </Button>
  );
}

function UserSlot() {
  const user = useUser();
  if (env.VITE_DEMO_MODE) return null;
  return user ? <NavUser compact /> : <SignInButton />;
}

export function AppIconRail() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const pauseDemoRotation = useDemoInteractionPause();

  useEffect(() => {
    if (!env.VITE_DEMO_MODE) return;
    if (!isEmbeddedFrame()) return;

    const intervalId = window.setInterval(() => {
      if (pauseDemoRotation) return;

      const currentIndex = ITEMS.findIndex((item) => item.matches(pathname));
      const nextItem = ITEMS[(currentIndex + 1) % ITEMS.length] ?? ITEMS[0];
      void navigate({ to: nextItem.to });
    }, DEMO_ROTATION_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [navigate, pathname, pauseDemoRotation]);

  return (
    <nav className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-2">
      <Link
        to="/"
        aria-label="g-spot"
        className="mb-1 flex size-9 items-center justify-center rounded-md hover:bg-sidebar-accent"
      >
        <Logo className="size-5" />
      </Link>

      <div className="flex flex-1 flex-col items-center gap-1">
        {ITEMS.map((item) => (
          <RailButton key={item.id} item={item} active={item.matches(pathname)} />
        ))}
      </div>

      <div className="flex flex-col items-center gap-1">
        <DesktopUpdateButton compact />
        <ThemePicker compact side="right" sideOffset={8} />
        <CatchBoundary
          getResetKey={() => pathname}
          errorComponent={SignInButton}
        >
          <UserSlot />
        </CatchBoundary>
      </div>
    </nav>
  );
}
