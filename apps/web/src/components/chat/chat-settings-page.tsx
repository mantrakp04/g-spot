import { Card, CardContent } from "@g-spot/ui/components/card";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, PlugZap } from "lucide-react";

import {
  PiAgentSettingsTabs,
  isPiAgentSettingsTab,
  type PiAgentSettingsTab,
} from "@/components/pi/pi-agent-settings-tabs";
import { usePiCatalog, usePiDefaults } from "@/hooks/use-pi";

export type ChatSettingsTab = PiAgentSettingsTab;

export const isChatSettingsTab = isPiAgentSettingsTab;

interface ChatSettingsPageProps {
  tab: ChatSettingsTab;
  onTabChange: (tab: ChatSettingsTab) => void;
}

export function ChatSettingsPage({ tab, onTabChange }: ChatSettingsPageProps) {
  const piCatalog = usePiCatalog();
  const piDefaults = usePiDefaults();

  const loadError = piCatalog.error ?? piDefaults.error;

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto max-w-5xl space-y-8 px-4 py-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Link
              to="/chat"
              className="inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Back to chat
            </Link>

            <header className="space-y-2">
              <h1 className="font-semibold text-2xl tracking-tight">Agent settings</h1>
              <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
                Configure the default Pi agent, add-ons, and skills that apply
                across every project.
              </p>
            </header>
          </div>

          <Link
            to="/settings/connections"
            className="inline-flex h-7 items-center gap-2 border border-border bg-background px-2.5 text-xs transition-colors hover:bg-muted hover:text-foreground"
          >
            <PlugZap className="size-4" />
            Manage provider auth
          </Link>
        </div>

        {loadError ? (
          <Card className="rounded-xl border-destructive/30 bg-destructive/5">
            <CardContent className="py-5">
              <p className="text-sm">
                {loadError instanceof Error
                  ? loadError.message
                  : "Could not load Pi settings."}
              </p>
            </CardContent>
          </Card>
        ) : null}

        <PiAgentSettingsTabs
          tab={tab}
          onTabChange={onTabChange}
          addonsDescription="Pi-managed packages and drop-in extensions that are available across every project. Individual projects can layer on their own add-ons without touching this global scope."
          skillsDescription="Skills you can use across every project. A project-scoped skill with the same name will shadow the global one inside that project."
          mcpDescription="Global MCP servers — they spawn on app start and are available to every chat in every project. Project-scoped servers from a project's .mcp.json layer on top."
        />
      </div>
    </div>
  );
}
