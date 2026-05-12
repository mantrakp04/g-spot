import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@g-spot/ui/components/dropdown-menu";

import type { trpcClient } from "@/utils/trpc";

type Stash = Awaited<
  ReturnType<typeof trpcClient.git.stashList.query>
>["stashes"][number];

type Props = {
  label: string;
  stashes: Stash[] | undefined;
  onSelect: (index: number) => void;
};

export function StashSubMenu({ label, stashes, onSelect }: Props) {
  const list = stashes ?? [];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-64 w-72 overflow-y-auto">
        {list.length === 0 ? (
          <DropdownMenuItem disabled>No stashes</DropdownMenuItem>
        ) : (
          list.map((s) => (
            <DropdownMenuItem
              key={s.index}
              onClick={() => onSelect(s.index)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                stash@{`{${s.index}}`}
              </span>
              <span className="truncate text-xs">{s.message}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
