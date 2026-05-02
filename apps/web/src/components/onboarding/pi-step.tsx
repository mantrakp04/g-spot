import { useState } from "react";

import {
  PiAgentSettingsTabs,
  type PiAgentSettingsTab,
} from "@/components/pi/pi-agent-settings-tabs";

export function PiStep() {
  const [tab, setTab] = useState<PiAgentSettingsTab>("agent");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Configure your AI agent
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You already linked your providers in the connections step. Pick the
          default chat and worker models, tune Pi's behavior, and pre-load any
          add-ons, skills, or MCP servers you want available everywhere. You
          can change all of this later in agent settings.
        </p>
      </div>

      <PiAgentSettingsTabs tab={tab} onTabChange={setTab} />
    </div>
  );
}
