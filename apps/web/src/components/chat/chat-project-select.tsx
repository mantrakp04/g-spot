import { Button } from "@g-spot/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@g-spot/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import { cn } from "@g-spot/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, FolderIcon } from "lucide-react";
import { useState } from "react";

import { useProjects } from "@/hooks/use-projects";

type ChatProjectSelectProps = {
  projectId: string;
  projectName: string;
  className?: string;
};

export function ChatProjectSelect({
  projectId,
  projectName,
  className,
}: ChatProjectSelectProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("text-muted-foreground hover:text-foreground", className)}
          />
        }
      >
        <FolderIcon />
        <span className="truncate">{projectName}</span>
        <ChevronDownIcon className="opacity-60" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[min(18rem,calc(100vw-2rem))] overflow-hidden p-0"
        sideOffset={6}
      >
        <Command className="bg-transparent">
          <CommandInput placeholder="Search projects" />
          <CommandList className="max-h-72">
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup heading="Projects" className="p-1">
              {projects.map((project) => {
                const isSelected = project.id === projectId;
                return (
                  <CommandItem
                    key={project.id}
                    value={project.id}
                    keywords={[project.name, project.path]}
                    data-checked={isSelected}
                    onSelect={() => {
                      setOpen(false);
                      if (isSelected) return;
                      void navigate({
                        to: "/projects/$projectId",
                        params: { projectId: project.id },
                      });
                    }}
                  >
                    <FolderIcon className="text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-xs">
                        {project.name}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {project.path}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
