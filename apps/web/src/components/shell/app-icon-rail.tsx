import { useCallback, useState } from "react";

import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@stackframe/react";
import { Link, useRouterState } from "@tanstack/react-router";
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
import { ThemePicker } from "@/components/tweakcn-theme-picker";
import { signInWithExternalBrowser } from "@/lib/desktop-auth";

type RailItem = {
  id: string;
  label: string;
  icon: typeof Inbox;
  to: string;
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
    label: "AI",
    icon: BotIcon,
    to: "/projects",
    matches: (p) => p.startsWith("/projects") || p.startsWith("/chat"),
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

export function AppIconRail() {
  const user = useUser();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
        <ThemePicker compact side="right" sideOffset={8} />
        {user ? (
          <NavUser compact />
        ) : (
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
        )}
      </div>
    </nav>
  );
}
