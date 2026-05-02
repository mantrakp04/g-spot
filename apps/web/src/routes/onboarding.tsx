import { useCallback, useMemo } from "react";

import { Button } from "@g-spot/ui/components/button";
import { Progress } from "@g-spot/ui/components/progress";
import { cn } from "@g-spot/ui/lib/utils";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainIcon,
  Github,
  Inbox,
  Mail,
  NotebookText,
  Palette,
  PanelsTopLeft,
} from "lucide-react";

import { useOnboarded } from "@/hooks/use-onboarded";
import { ConnectionsStep } from "@/components/onboarding/connections-step";
import { PiStep } from "@/components/onboarding/pi-step";
import { SectionsStep } from "@/components/onboarding/sections-step";
import { ThemeStep } from "@/components/onboarding/theme-step";
import { TourStep } from "@/components/onboarding/tour-step";
import {
  MemoryVisual,
  NotesVisual,
  ReviewsVisual,
  WorkflowsVisual,
} from "@/components/onboarding/tour-visuals";

const STEPS = [
  { id: "theme", title: "Pick your theme", icon: Palette },
  { id: "connections", title: "Connect accounts", icon: Mail },
  { id: "sections", title: "Set up sections", icon: PanelsTopLeft },
  { id: "agent", title: "Configure your AI agent", icon: Bot },
  { id: "memory", title: "Memory", icon: BrainIcon },
  { id: "reviews", title: "GitHub reviews", icon: Github },
  { id: "workflows", title: "Gmail workflows", icon: Inbox },
  { id: "notes", title: "Notes", icon: NotebookText },
] as const;

type StepId = (typeof STEPS)[number]["id"];

const STEP_IDS = STEPS.map((step) => step.id) as readonly StepId[];

function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && (STEP_IDS as readonly string[]).includes(value);
}

type OnboardingSearch = {
  step?: StepId;
};

export const Route = createFileRoute("/onboarding")({
  component: OnboardingRoute,
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => ({
    step: isStepId(search.step) ? search.step : undefined,
  }),
});

function OnboardingRoute() {
  const { step } = Route.useSearch();
  const navigate = useNavigate();
  const { markOnboarded } = useOnboarded();

  const activeStep: StepId = step ?? "theme";
  const activeIndex = STEPS.findIndex((entry) => entry.id === activeStep);
  const isLast = activeIndex === STEPS.length - 1;
  const isFirst = activeIndex === 0;

  const goTo = useCallback(
    (id: StepId) => {
      void navigate({
        to: "/onboarding",
        search: { step: id === "theme" ? undefined : id },
        replace: true,
      });
    },
    [navigate],
  );

  const finish = useCallback(() => {
    markOnboarded();
    void navigate({ to: "/", replace: true });
  }, [markOnboarded, navigate]);

  const next = useCallback(() => {
    if (isLast) {
      finish();
      return;
    }
    goTo(STEPS[activeIndex + 1].id);
  }, [activeIndex, finish, goTo, isLast]);

  const prev = useCallback(() => {
    if (isFirst) return;
    goTo(STEPS[activeIndex - 1].id);
  }, [activeIndex, goTo, isFirst]);

  const progressValue = useMemo(
    () => ((activeIndex + 1) / STEPS.length) * 100,
    [activeIndex],
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-56 shrink-0 border-r border-border/60 px-3 py-6 md:block">
          <ol className="space-y-1">
            {STEPS.map((entry, index) => {
              const Icon = entry.icon;
              const isActive = entry.id === activeStep;
              const isComplete = index < activeIndex;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => goTo(entry.id)}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums",
                        isActive && "border-primary bg-primary text-primary-foreground",
                        !isActive && isComplete && "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
                        !isActive && !isComplete && "border-border bg-background",
                      )}
                    >
                      {index + 1}
                    </span>
                    <Icon className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-8">
            {(() => {
              const isTour =
                activeStep === "memory" ||
                activeStep === "reviews" ||
                activeStep === "workflows" ||
                activeStep === "notes";
              return (
                <div
                  className={cn(
                    "mx-auto",
                    activeStep === "agent" ? "max-w-5xl" : "max-w-3xl",
                    isTour && "flex min-h-full items-center",
                  )}
                >
                  <div className="w-full">
                    <StepBody step={activeStep} />
                  </div>
                </div>
              );
            })()}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-6 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={prev}
                disabled={isFirst}
                className={cn(isFirst && "invisible")}
              >
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {activeIndex + 1} / {STEPS.length}
                </span>
                <Progress value={progressValue} className="h-1 w-32" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={finish}
              >
                Skip all
              </Button>
              <Button variant="ghost" size="sm" onClick={next}>
                {isLast ? "Skip" : "Skip step"}
              </Button>
              <Button size="sm" onClick={next}>
                {isLast ? "Finish" : "Next"}
                {!isLast && <ArrowRight className="size-3.5" />}
              </Button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

function StepBody({ step }: { step: StepId }) {
  switch (step) {
    case "theme":
      return <ThemeStep />;
    case "connections":
      return <ConnectionsStep />;
    case "sections":
      return <SectionsStep />;
    case "agent":
      return <PiStep />;
    case "memory":
      return (
        <TourStep
          icon={BrainIcon}
          title="Memory"
          tagline="Pi remembers what matters."
          description="Your AI agent builds a memory graph as you work. Pin facts, edit them, or browse the graph from settings. Memory is local and per-machine."
          bullets={[
            "Auto-captured from chats and tool calls",
            "Editable knowledge graph",
            "Used to ground future responses",
          ]}
          visual={<MemoryVisual />}
        />
      );
    case "reviews":
      return (
        <TourStep
          icon={Github}
          title="GitHub reviews"
          tagline="Triage PRs without leaving the app."
          description="Open a PR from any GitHub section and review inline — diff, threads, suggestions, and queued review comments — then submit them in one batch."
          bullets={[
            "Inline diff viewer with comment threads",
            "Queue multiple comments and submit as one review",
            "Approve, request changes, or comment from the same view",
          ]}
          visual={<ReviewsVisual />}
        />
      );
    case "workflows":
      return (
        <TourStep
          icon={Inbox}
          title="Gmail workflows"
          tagline="Automations for your inbox."
          description="Define workflows that run on incoming Gmail — auto-label, draft replies with Pi, snooze, or trigger custom actions. Configure them anytime from Settings → Gmail workflows."
          bullets={[
            "Trigger on new mail matching a filter",
            "Compose Pi-drafted replies for review",
            "Combine actions in a single workflow",
          ]}
          visual={<WorkflowsVisual />}
        />
      );
    case "notes":
      return (
        <TourStep
          icon={NotebookText}
          title="Notes"
          tagline="Markdown notes that link back."
          description="Wikilinks, tags, math, Mermaid diagrams, daily notes — all stored locally. Drop links to threads, PRs, and chats; Pi can read and write notes for you."
          bullets={[
            "Wikilinks and backlinks",
            "Math, Mermaid, code, daily notes",
            "Pi can read and write notes",
          ]}
          visual={<NotesVisual />}
        />
      );
  }
}
