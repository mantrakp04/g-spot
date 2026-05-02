import { Skeleton } from "@g-spot/ui/components/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@g-spot/ui/components/tabs";

import { McpView } from "@/components/mcp/mcp-view";
import { PiAddonsView } from "@/components/pi/pi-addons-page";
import { PiAgentDefaultsCard } from "@/components/pi/pi-agent-defaults-card";
import { SkillsView } from "@/components/skills/skills-page";
import { usePiCatalog, usePiDefaults } from "@/hooks/use-pi";

export type PiAgentSettingsTab = "agent" | "addons" | "skills" | "mcp";

const TAB_VALUES: PiAgentSettingsTab[] = ["agent", "addons", "skills", "mcp"];

export function isPiAgentSettingsTab(
  value: unknown,
): value is PiAgentSettingsTab {
  return typeof value === "string" && (TAB_VALUES as string[]).includes(value);
}

interface PiAgentSettingsTabsProps {
  tab: PiAgentSettingsTab;
  onTabChange: (tab: PiAgentSettingsTab) => void;
  addonsDescription?: string;
  skillsDescription?: string;
  mcpDescription?: string;
}

export function PiAgentSettingsTabs({
  tab,
  onTabChange,
  addonsDescription,
  skillsDescription,
  mcpDescription,
}: PiAgentSettingsTabsProps) {
  const piCatalog = usePiCatalog();
  const piDefaults = usePiDefaults();
  const isLoading = piCatalog.isLoading || piDefaults.isLoading;

  return (
    <Tabs value={tab} onValueChange={(next) => onTabChange(next as PiAgentSettingsTab)}>
      <TabsList>
        <TabsTrigger value="agent">Agent</TabsTrigger>
        <TabsTrigger value="addons">Add-ons</TabsTrigger>
        <TabsTrigger value="skills">Skills</TabsTrigger>
        <TabsTrigger value="mcp">MCP</TabsTrigger>
      </TabsList>

      <TabsContent value="agent" className="pt-6">
        {isLoading ? (
          <Skeleton className="h-[720px] w-full rounded-xl" />
        ) : (
          <PiAgentDefaultsCard />
        )}
      </TabsContent>

      <TabsContent value="addons" className="pt-6">
        <PiAddonsView projectId={null} description={addonsDescription} />
      </TabsContent>

      <TabsContent value="skills" className="pt-6">
        <SkillsView projectId={null} description={skillsDescription} />
      </TabsContent>

      <TabsContent value="mcp" className="pt-6">
        <McpView projectId={null} description={mcpDescription} />
      </TabsContent>
    </Tabs>
  );
}
